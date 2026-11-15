/**
 * run_haiku.mjs — Claude Haiku 4.5 판정 (클라우드 실행용)
 * 실행: node run_haiku.mjs [출력파일명]
 */
import https from "node:https"
import { readFileSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dir = dirname(fileURLToPath(import.meta.url))
const BASE = join(__dir, "..")

const { checkTime } = await import(join(BASE, "check_time.mjs"))

const PROMPT_FILE = join(BASE, "judge_generated.prompt.txt")
const outName = process.argv[2] || "result_haiku_" + Date.now() + ".json"
const OUT_FILE = join(__dir, outName)

const AI_GATEWAY_API_KEY = process.env.AI_GATEWAY_API_KEY
if (!AI_GATEWAY_API_KEY) { console.error("AI_GATEWAY_API_KEY not set"); process.exit(1) }

const prompt = readFileSync(PROMPT_FILE, "utf8")

function callClaude(messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "anthropic/claude-haiku-4-5",
      messages,
      temperature: 0,
      max_tokens: 3000,
    })
    const req = https.request(
      {
        hostname: "ai-gateway.vercel.sh",
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${AI_GATEWAY_API_KEY}`,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = ""
        res.on("data", c => data += c)
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data)
            if (parsed.error) return reject(new Error(parsed.error.message))
            const usage = parsed.usage || {}
            console.log(`Tokens: in=${usage.prompt_tokens} out=${usage.completion_tokens}`)
            // Claude Haiku 4.5: input $0.80/MTok, output $4.00/MTok
            const cost = (usage.prompt_tokens * 0.80 + usage.completion_tokens * 4.00) / 1_000_000
            console.log(`비용: $${cost.toFixed(6)}`)
            resolve(parsed.choices[0].message.content.trim())
          } catch (e) {
            reject(new Error(`JSON parse error: ${e.message}\nRaw: ${data.slice(0,300)}`))
          }
        })
      }
    )
    req.setTimeout(90000, () => req.destroy(new Error("판정 요청 시간 초과")))
    req.on("error", reject)
    req.write(body)
    req.end()
  })
}

console.log("판정 요청 중 (claude-haiku-4-5)...")
const result = await callClaude([{ role: "user", content: prompt }])

let parsed
try {
  const start = result.indexOf("{")
  const end   = result.lastIndexOf("}")
  parsed = JSON.parse(result.slice(start, end + 1))
  console.log(`판정 완료: ${Object.keys(parsed).length}개 항목`)
} catch (e) {
  console.error("JSON 파싱 실패:", e.message)
  console.log("원본 응답:", result.slice(0, 500))
  process.exit(1)
}

const items = JSON.parse(prompt.split("Items (JSON):\n")[1]);
if (Object.keys(parsed).length !== items.length || items.some(({ n, clause }) => {
  const verdict = parsed[n];
  return typeof verdict?.matched_sentence !== "string"
    || !clause.includes(verdict.matched_sentence)
    || !["same", "different", "unclear"].includes(verdict.event_match)
    || typeof verdict.prior_reference !== "boolean"
    || (verdict.event_match !== "unclear" && !verdict.matched_sentence.trim());
})) {
  throw new Error("문항 번호, 원문 인용 또는 사건 연결 필드가 잘못됐습니다.");
}

function weddingAttendee(text) {
  const source = text.match(/^The user attended the wedding of (.+?)[.!?]?$/i);
  const restatement = text.match(/^I (?:attended|went to) (.+?)[‘’]s wedding[.!?]?$/i);
  return (source?.[1] ?? restatement?.[1])?.trim().toLowerCase();
}

for (const item of items) {
  const verdict = parsed[item.n];
  const date_checks = checkTime(verdict.matched_sentence, item);
  const conflict = date_checks.find(check => !check.consistent);
  const evidence = typeof verdict.different_evidence === "string"
    ? verdict.different_evidence.trim() : "";
  const sourceWords = new Set(item.source_statement.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const evidenceWithoutDates = checkTime(evidence, item).reduce(
    (quote, { expression }) => quote.replaceAll(expression.toLowerCase(), " "),
    evidence.toLowerCase(),
  );
  const evidenceWords = evidenceWithoutDates.match(/[\p{L}\p{N}]{4,}/gu) ?? [];
  const repeatsSource = evidenceWords.length > 0 && evidenceWords.every(word => sourceWords.has(word));
  const sourceWedding = weddingAttendee(item.source_statement);
  const repeatsWedding = sourceWedding !== undefined
    && sourceWedding === weddingAttendee(evidenceWithoutDates.trim());
  if (verdict.event_match === "different") {
    if (!evidence || !verdict.matched_sentence.includes(evidence)) {
      verdict.event_match = "unclear";
    } else if (repeatsSource || repeatsWedding) {
      verdict.event_match = "same";
    }
  }
  let label, reason;
  if (verdict.event_match === "different") {
    label = "B"; reason = "The selected wording describes a different event.";
  } else if (verdict.event_match === "unclear") {
    label = "C"; reason = "The selected wording does not identify the source event.";
  } else if (conflict) {
    label = "B"; reason = `The expression "${conflict.expression}" conflicts with the source dates.`;
  } else if (date_checks.length || verdict.prior_reference) {
    label = "A"; reason = "";
  } else {
    label = "C"; reason = "No checked date or reference ties the wording to the source event.";
  }
  Object.assign(verdict, { label, reason, date_checks });
}

// raw 모델 응답 저장 (후처리 전 — 모델이 판정한 event_match 그대로)
const rawOut = OUT_FILE.replace(/\.json$/, "_raw.json")
const rawParsed = JSON.parse(result.slice(result.indexOf("{"), result.lastIndexOf("}") + 1))
writeFileSync(rawOut, JSON.stringify(rawParsed, null, 2), "utf8")
console.log(`raw 저장: ${rawOut}`)

writeFileSync(OUT_FILE, JSON.stringify(parsed, null, 2), "utf8")
console.log(`결과 저장: ${OUT_FILE}`)

const labels = Object.values(parsed).map(v => v.label)
const A = labels.filter(l => l === "A").length
const B = labels.filter(l => l === "B").length
const C = labels.filter(l => l === "C").length
console.log(`\nA(통과): ${A}  B(실패): ${B}  C(미확정): ${C}  합계: ${labels.length}`)
