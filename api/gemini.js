// api/gemini.js — Vercel Serverless Function
// 프론트엔드가 계산한 결과(payload)를 받아 Gemini에게 "종합 코멘트 + 과목별 분석"을 요청하는 프록시.
// GEMINI_API_KEY는 이 함수 안(process.env)에서만 쓰이며, 브라우저/저장소에는 절대 노출되지 않는다.
// 등급/확률 같은 숫자는 절대 AI가 다시 계산하지 않는다 — 이미 계산된 숫자를 근거로 문장만 쓰게 한다.

// 모델 ID. 만약 호출이 404("model not found")로 실패하면, 이 한 줄만 최신 모델명으로 바꾸면 된다.
const GEMINI_MODEL = 'gemini-3.1-flash-lite';

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    overall: { type: 'string' },
    subjects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          analysis: { type: 'string' }
        },
        required: ['name', 'analysis']
      }
    }
  },
  required: ['overall', 'subjects']
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: '서버에 GEMINI_API_KEY 환경변수가 설정되지 않았습니다.' });
    return;
  }

  const payload = req.body || {};
  const prompt = buildPrompt(payload);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1500,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA
        }
      })
    });
    const data = await r.json();
    if (!r.ok) {
      res.status(r.status).json({ error: (data && data.error && data.error.message) || 'Gemini 호출에 실패했습니다.' });
      return;
    }
    const parts = data && data.candidates && data.candidates[0] &&
      data.candidates[0].content && data.candidates[0].content.parts;
    const raw = Array.isArray(parts) ? parts.map(p => p.text || '').join('') : '';

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      res.status(502).json({ error: 'AI 응답을 해석할 수 없습니다.' });
      return;
    }
    if (!parsed || typeof parsed.overall !== 'string' || !Array.isArray(parsed.subjects)) {
      res.status(502).json({ error: 'AI 응답 형식이 예상과 다릅니다.' });
      return;
    }
    res.status(200).json(parsed);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}

function buildPrompt(payload) {
  const subjects = Array.isArray(payload.subjects) ? payload.subjects : [];
  const c = payload.conditions || {};
  const h = payload.habitScore || {};

  const subjectLines = subjects.map(s =>
    `- ${s.name}: 중간 ${s.mid}등급 → 목표 ${s.target}등급, 필요 기말 ${s.unreachable ? '달성 불가' : s.neededFinal + '등급'}, 최근 추이 ${s.trend}, 달성 확률 약 ${s.probability}%`
  ).join('\n');

  return `너는 대한민국 고등학생의 내신 성적을 상담하는 학습 컨설턴트야.
아래는 한 학생의 기말고사 목표와 학습 조건을 프로그램이 미리 계산한 결과야.
숫자(등급, 확률 등)는 절대 다시 계산하거나 바꾸지 말고, 주어진 값을 그대로 근거로 삼아 조언만 작성해.

[과목별 목표와 확률]
${subjectLines || '- (입력된 과목 없음)'}

[학습 조건]
- 시험까지 남은 기간: ${c.daysLeft}일
- 하루 순공 시간: ${c.studyHours}시간 (권장 ${c.recommendedHours}시간)
- 기상 시간: ${c.wakeTime}
- 하루 스마트폰 사용: ${c.phoneHours}시간
- 주 학습 방식: ${c.efficiency}

[학습 습관 점수(100점 만점)]
- 종합 ${h.overall}점 / 공부시간 ${h.study} / 기상 ${h.wake} / 스마트폰 ${h.phone} / 학습효율 ${h.efficiency}

아래 JSON 스키마 형식으로만 응답해. 마크다운 기호(*, #, - 등)는 쓰지 말고 자연스러운 존댓말 문장으로 작성해.

- "overall": 위 학생의 전체 상황을 종합한 진단 + 가장 시급한 개선점 + 남은 기간을 고려한 전체적인 학습 방향을 3~5문장으로.
- "subjects": 입력된 과목 각각에 대해 { "name": 과목명(위 목록과 정확히 동일하게), "analysis": 2~3문장 } 형태로, 그 과목의 등급차·확률·난이도 상승폭을 근거로 그 과목만의 구체적인 공부 방안(우선순위, 단원/유형, 시간 배분 등)을 작성. 과목 개수와 순서는 입력과 동일하게 유지해.`;
}
