// api/ai-analysis.js — Claude AI로 시장 심리 + 최신 경제 뉴스 해석
//
// 변경 이력: 해외 추정가(바이낸스/바이비트) 기능은 Vercel 서버 IP가 지역 차단되어
// 안정적으로 구현 불가능한 것으로 확인되어 완전히 포기함. 대신 "앱이 살아있다"는
// 느낌을 주는 핵심 기능을 이 AI 해석에 집중시킴 — 5분마다 코스피/미국 특징주와
// 시가총액 상위 기업 관련 최신 뉴스를 직접 검색해서 반영하도록 재설계.
//
// 캐시 정책: 5분 캐시(s-maxage=300)를 둠으로써 (1) 같은 5분 동안 여러 사용자가 봐도
// 동일한 해석을 보여줘 일관성 유지, (2) 매 요청마다 웹 검색+API 비용이 발생하지 않게
// 막아 비용을 합리적인 수준으로 유지. 프론트엔드도 5분마다만 새로 호출함.

const KOSPI_TOP10 = '삼성전자, SK하이닉스, 삼성바이오로직스, LG에너지솔루션, 현대차, 기아, 셀트리온, 삼성물산, POSCO홀딩스, KB금융';
const US_TOP10 = 'NVIDIA, Alphabet, Apple, SpaceX, Microsoft, Amazon, TSMC, Broadcom, Tesla, Meta';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300'); // 5분 캐시 — 프론트엔드 폴링 주기와 일치
  if (req.method !== 'POST') return res.status(405).end();

  const { score, kospiChg, usdkrw } = req.body || {};

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ai-analysis: ANTHROPIC_API_KEY 환경변수가 설정되지 않음');
    return res.status(500).json({ text: 'AI 분석 일시 불가. 잠시 후 새로고침해 주세요.' });
  }

  try {
    const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // 빠르고 저렴한 모델 (웹 검색 도구도 지원)
        max_tokens: 600, // 여러 주제 검색 시 중간 추론 토큰이 늘어나 여유를 둠
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
        messages: [{
          role: 'user',
          content: `지금 시각(${now}) 기준 최신 경제 뉴스를 검색해서 한국 투자자를 위한 시장 브리핑을
작성해주세요.

검색해서 확인할 내용 (각각 검색 1~2회씩, 총 4회 이내):
1. 오늘 코스피 특징주(시장에서 화제가 된 종목과 이유)
2. 오늘 미국 증시 특징주(화제가 된 종목과 이유)
3. 코스피 시가총액 상위 기업(${KOSPI_TOP10}) 중 최신 뉴스가 있는 기업
4. 미국 시가총액 상위 기업(${US_TOP10}) 중 최신 뉴스가 있는 기업

참고용 시장 데이터: K-공탐지수 ${score}점, KOSPI 등락률 ${kospiChg > 0 ? '+' : ''}${kospiChg}%, 원달러 환율 ${usdkrw}원

위 검색 결과를 종합해서, 한국어로 4~5문장 분량의 시장 브리핑을 작성해주세요:
- 코스피 특징주 1~2문장
- 미국 증시/특징주 1~2문장
- 전체 분위기를 한 문장으로 마무리
구체적인 종목명과 이유를 자연스럽게 녹여 작성하고, 투자 권유 표현(매수/매도 추천 등)은
쓰지 말고 사실 전달과 분위기 설명에 집중해주세요. 일반 투자자가 이해하기 쉬운 평이한 문장으로
작성해주세요.`
        }]
      })
    });

    const d = await r.json();

    if (!r.ok) {
      // Anthropic API가 에러를 반환한 경우 (크레딧 부족, 키 오류, rate limit 등)
      // d.error.type 예: invalid_request_error, authentication_error, rate_limit_error, overloaded_error 등
      console.error(
        `ai-analysis: Anthropic API 오류 (status=${r.status})`,
        d.error?.type, d.error?.message
      );
      return res.status(502).json({ text: 'AI 분석 일시 불가. 잠시 후 새로고침해 주세요.' });
    }

    // 웹 검색 도구를 쓰면 응답에 tool_use/tool_result 블록이 섞여서 오므로,
    // type이 'text'인 블록만 모아서 최종 해석 문장을 구성함
    const text = (d.content || [])
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join(' ')
      .trim();

    if (!text) {
      console.error('ai-analysis: 응답에 text 없음', JSON.stringify(d).slice(0, 300));
      return res.status(502).json({ text: '시장 분석 데이터를 불러올 수 없습니다.' });
    }

    res.status(200).json({ text });

  } catch (e) {
    console.error('ai-analysis: 요청 처리 중 예외 발생', e.message);
    res.status(500).json({ text: 'AI 분석 일시 불가. 잠시 후 새로고침해 주세요.' });
  }
}
