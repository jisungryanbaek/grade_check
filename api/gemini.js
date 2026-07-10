// api/gemini.js — Vercel Serverless Function
// 프론트엔드가 계산한 결과(payload)를 받아 Gemini에게 "종합 코멘트 + 공부 방안"을 요청하는 프록시.
// GEMINI_API_KEY는 이 함수 안(process.env)에서만 쓰이며, 브라우저/저장소에는 절대 노출되지 않는다.

// 모델 ID. 만약 호출이 404("model not found")로 실패하면, 이 한 줄만 최신 모델명으로 바꾸면 된다.
const GEMINI_MODEL = 'gemini-3.1-flash-lite';

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
        generationConfig: { temperature: 0.7, maxOutputTokens: 800 }
      })
    });
    const data = await r.json();
    if (!r.ok) {
      res.status(r.status).json({ error: (data && data.error && data.error.message) || 'Gemini 호출에 실패했습니다.' });
      return;
    }
    const parts = data && data.candidates && data.candidates[0] &&
      data.candidates[0].content && data.candidates[0].content.parts;
    const text = Array.isArray(parts) ? parts.map(p => p.text || '').join('') : '';
    res.status(200).json({ text });
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
숫자를 다시 계산하지 말고, 주어진 값을 근거로 삼아 조언만 작성해.

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

다음 세 가지를 따뜻하지만 객관적인 존댓말로 작성해:
1) 현재 상황 종합 진단 (2~3문장)
2) 가장 시급한 개선점 1~2가지와 그 이유
3) 남은 기간을 고려한 구체적인 공부 방안 (과목 우선순위와 시간 배분 등 실천 가능한 형태)

마크다운 기호(*, #, - 등)는 쓰지 말고, 각 항목을 자연스러운 문단으로 구분해서 작성해줘.`;
}
