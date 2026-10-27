'use strict';
/**
 * llm-mask.js — LLM(OpenAI) 전송 «직전» 접수 원문 비식별 (순수 함수, 외부 의존 0)
 *
 * 배경/범위:
 *   - src/llm-shadow.js 의 maskPii 는 «저장용»(llm_shadow_logs.maskedText)이라 전송 경로와 무관하다.
 *     이 파일은 «전송용»이다. 둘은 목적이 달라 규칙도 다르다(여기선 호실 번호를 지우지 않는다 —
 *     호실은 분류 근거이고, 전송 상대는 위치를 알아야 건물/섹터를 맞춘다).
 *   - 규칙 엔진(intake-rules)·shadow 기록은 이 함수를 «거치지 않는다». 서버 내부 경로이기 때문이다.
 *
 * 설계 원칙 — 위양성(오탐)이 위음성보다 나쁘다:
 *   민원 본문에서 위치·증상 서술이 지워지면 분류가 틀리고, 틀린 분류는 곧바로 접수 품질로 드러난다.
 *   그래서 모든 규칙은 «확실할 때만» 지운다. 특히 이름은 호칭이 붙은 형태 + 흔한 성씨 화이트리스트일 때만 건드린다.
 *
 * 처리 순서:
 *   0) 정리     : 분해형 한글(NFD)을 모으고, 숫자·@ 바로 옆의 보이지 않는 문자를 뺀다.
 *                 전각 숫자·＠－．＋ 는 찾을 때만 반각으로 보고, 내보내는 글은 지운 자리 말고는 그대로 둔다.
 *   1) 이메일   : «반드시 먼저». 학번·전화 규칙이 먼저 돌면 로컬파트 숫자만 지워지고 도메인이 남는다
 *                 (2026012345@example.ac.kr → [학번]@example.ac.kr).
 *   2) 주민번호 : 13자리.
 *   3) 학번     : 20으로 시작하는 10자리.
 *   4) 전화     : 0으로 시작하는 9~12자리.
 *      2)~4)는 모두 앞뒤 «숫자 경계»(바로 앞뒤에 숫자가 없을 것)를 건다. 그래서 한 규칙이 더 긴 숫자열의 일부를
 *      잘라 가지 못하고, 2)~4)끼리는 순서를 바꿔도 결과가 같다. 경계가 없으면 3000000000원 → 3[전화]원,
 *      202012345678 → [학번]78 처럼 긴 숫자 안쪽이 잘려 나간다.
 *   5) 이름     : 마지막. 앞에서 넣은 [전화] 같은 말은 이름 규칙에 걸리지 않는다(이름을 맨 앞에 둬도 결과는 같다).
 */

/** 치환 문자열 — 종류가 남아야 LLM 이 "연락처를 남겼다" 같은 문맥을 잃지 않는다. */
const REPLACEMENT = Object.freeze({
  phone: '[전화]',
  rrn: '[주민번호]',
  email: '[메일]',
  studentId: '[학번]',
  name: '[이름]',
});

// ── 0) 정리 ──────────────────────────────────────────────────────────────────
//   - 맥에서 복사한 분해형 한글(ㄱ+ㅣ+ㅁ)은 이름 규칙에 안 걸리므로 조합형으로 모은다.
//   - 폭 없는 공백 같은 보이지 않는 문자는 숫자나 @ 바로 옆에 있을 때만 뺀다(이모지 이음 문자 등은 그대로).
//   - 전각 숫자와 ＠－．＋ 는 «찾을 때만» 반각으로 본다. 내보내는 글에서는 지운 자리 말고는 원래 글자 그대로다.
const NFD_HANGUL_RE = new RegExp('[\\u1100-\\u11FF]');
const INVISIBLE = '[\\u00AD\\u200B-\\u200D\\u2060\\uFEFF]+';
const DIGIT_OR_AT = '[0-9@\\uFF10-\\uFF19\\uFF20]';
const INVISIBLE_RE = new RegExp(`${INVISIBLE}(?=${DIGIT_OR_AT})|(?<=${DIGIT_OR_AT})${INVISIBLE}`, 'g');
const FULLWIDTH_RE = new RegExp('[\\uFF0B\\uFF0D\\uFF0E\\uFF10-\\uFF19\\uFF20]', 'g');

function tidy(s) {
  if (NFD_HANGUL_RE.test(s)) s = s.normalize('NFC');
  return s.replace(INVISIBLE_RE, '');
}
function toHalfWidth(s) {
  return s.replace(FULLWIDTH_RE, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
}

// 숫자 사이에 오는 공백(일반·탭·NBSP·전각)과 하이픈(- ‐ ‑ ‒ – — ― −, 휴대폰에서 대신 치는 ㅡ).
const SP = '[ \\t\\u00A0\\u3000]';
const DASH = '\\-\\u2010-\\u2015\\u2212ㅡ';

// ── 1) 이메일 ────────────────────────────────────────────────────────────────
//   로컬파트는 64자(표준 상한)까지만 본다. «+»로 두면 @ 없는 긴 영문·숫자 덩어리에서 시간이 길이의 제곱으로 는다.
const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

// ── 2) 주민등록번호 ──────────────────────────────────────────────────────────
//   하이픈(-) 하나로 잇거나 붙여 쓴 13자리는 그대로 잡는다.
//   그 밖의 구분(공백·점·다른 대시·띄운 하이픈)은 앞 6자리가 날짜(월 01~12, 일 01~31)일 때만 잡는다 —
//   "단가 150000 1500000" 같은 숫자 나열을 주민번호로 보지 않기 위해서다.
const YYMMDD = '\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])';
const RRN_RE = new RegExp(
  '(?<![0-9])(?:'
  + '\\d{6}-?[1-8]\\d{6}'
  + `|${YYMMDD}(?:${SP}*[${DASH}.]${SP}*|${SP}{1,2})[1-8]\\d{6}`
  + ')(?![0-9])', 'g');

// ── 3) 학번(20으로 시작하는 10자리) ──────────────────────────────────────────
//   날짜 20260826(8자리)·접수번호 FR-20260826-001 은 숫자 런이 8자리라 걸리지 않는다.
const STUDENT_ID_RE = /(?<![0-9])20\d{8}(?![0-9])/g;

// ── 4) 전화(휴대·일반·안심번호) ──────────────────────────────────────────────
//   0으로 시작 + (2~4자리 국번/식별) + (3~4자리) + (4자리).
//   구분자는 하이픈(변형 포함)·점·공백(두 칸까지), 하이픈·점 앞뒤 공백("010 - 1234 - 5678"),
//   그리고 국내 사무실 번호 표기인 닫는 괄호("02)760-1234", "(02) 760-1234").
//   앞자리는 «항상 2자리 이상»(0 뒤에 숫자가 반드시 온다)이라 "(0) 123 4567" 같은 것은 걸리지 않는다.
//   국가번호 표기도 받는다: "+82 10-1234-5678", "+82-10-…", "+82 (0)10-…", "+821012345678".
const PSEP = `(?:\\)${SP}?|${SP}*[${DASH}.]${SP}*|${SP}{1,2})`;
const PHONE_RE = new RegExp(
  `(?:\\+82${SP}?[${DASH}.]?${SP}?(?:\\(0\\)${SP}?)?0?|(?<![0-9])0)`
  + `\\d{1,3}${PSEP}?\\d{3,4}${PSEP}?\\d{4}(?![0-9])`, 'g');

// ── 5) 이름 + 호칭 ───────────────────────────────────────────────────────────
//   보수적 3중 잠금: ① 흔한 성씨로 시작 ② 전체 2~4자 ③ 호칭이 «반드시» 붙는다.
//   호칭 없는 맨 이름은 건드리지 않는다(사람 이름인지 판정할 근거가 없다).
const SURNAME_1 = '김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구';
const SURNAME_2 = '남궁|황보|제갈|사공|선우|독고';
// 호칭 — '님'이 있어도 없어도 되는 것(교수/교수님), 단독 '님'·'씨'.
const TITLE_WORDS = '교수|선생|박사|조교|연구원|주임|대리|과장|팀장|부장|처장|학생';
const TITLE_BASIC = `(?:(?:${TITLE_WORDS})님?|님|씨)`;
// 넓힌 호칭 — 부·조·명예교수 같은 교수 직함, 그리고 일반 낱말로도 흔해서(책임·수석·소장 …) '님'이 붙을 때만 보는 직급.
const TITLE = '(?:(?:(?:부|조|연구|겸임|명예|초빙|객원|석좌|특임|외래)?교수|(?:책임|선임|수석)?연구원|'
  + `${TITLE_WORDS})님?`
  + '|(?:강사|책임|선임|수석|실장|소장|원장|차장|주무관|행정관|센터장|본부장|학장|서무)님'
  + '|님|씨)';
// 호칭 바로 뒤에 붙어도 되는 말 — "김철수 교수님이", "홍길동님께". 이 밖의 한글이 이어지면(학생회관·학생증) 호칭으로 보지 않는다.
const PARTICLE_BASIC = '께서|께|에게|한테|이라|라고|의|이|가|은|는|을|를|도|만|과|와|에'
  + '|입니다|입니|이고|이며|인데|이에요|예요|이십니다|이세요|이신|이라는';   // 서술격 어미 — "김철수 학생입니다"
// 넓힌 말 — "교수님하고", "님으로부터", "님까지", "교수실", "교수님네".
const PARTICLE = PARTICLE_BASIC + '|하고|이랑|랑|으로|로|까지|부터|처럼|보다|네|요|실|연구실|랩|팀';

// 세 글자 이상 이름(성+두 글자, 복성+이름)은 넓힌 호칭·조사와 두 칸까지의 공백(탭·NBSP 포함)을 받는다.
const NAME_RE = new RegExp(
  '(?<![가-힣])'
  + `((?:${SURNAME_2})[가-힣]{1,2}|[${SURNAME_1}][가-힣]{2})`
  + `(${SP}{0,2})`
  + `(${TITLE})`
  + `(?:(?![가-힣])|(?=${PARTICLE}))`,
  'g',
);
// 예전 규칙(처음 공개한 판과 같은 정규식) — 넓힌 규칙에서 잡지 않은 것은 여기서 전처럼 본다.
//   두 글자 이름(성+외자: 김혁)은 일반 낱말(이상·조금·정규 …)과 겹치기 쉬워서 이 규칙으로만 본다.
const BASIC_NAME_RE = new RegExp(
  '(?<![가-힣])'
  + `((?:${SURNAME_2}|[${SURNAME_1}])[가-힣]{1,2})`
  + '( ?)'
  + `(${TITLE_BASIC})`
  + `(?:(?![가-힣])|(?=${PARTICLE_BASIC}))`,
  'g',
);
const PARTICLE_HEAD_RE = new RegExp(`^(?:${PARTICLE})`);

/** 이름 자리에 들어왔지만 사람 이름이 «아닌» 것이 확실한 낱말(성씨로 시작하는 일반명사). */
const NAME_STOPWORDS = new Set([
  '고객', '손님', '차장', '고등', '장애', '장학', '신입', '신고', '신청', '고장',
  '강의', '강의실', '강의동', '안전', '안내', '전기', '전산', '전체', '전화', '전공',
  '정보', '정문', '정기', '정수', '구매', '구내', '구역', '홍보', '차량', '주차', '주말',
  '오전', '오후', '오늘', '오늘날', '남녀', '이번', '이용', '이전', '최근', '최소', '최대',
  '문의', '문제', '성함', '하자', '하수', '노후', '배관', '배수', '조명', '조치',
  '유지', '유리', '임시', '한국', '서류', '백만', '심야', '양호', '허가', '우천',
  '권한', '황사', '박스', '송풍', '윤활',
  // 2026-10-27 점검에서 나온 오탐 — 사람을 가리키는 말 앞에 흔히 오는 낱말
  '우리', '이분', '이런', '남은', '남자', '전임', '신임', '신규', '전직', '정식', '전담', '우수', '최우수', '최종',
  '고학년', '이공계', '한국인', '한국어', '전교', '오전반', '오후반', '주간', '성인', '신관', '유치원', '유치', '유학',
  '성대', '성균관', '문과대', '유학대', '이과대', '서무', '강사', '이모', '고모', '조리', '조리사', '주방', '노무사', '조장', '고문', '전무',
  '신청자', '신고자', '이용자', '조경', '전산실', '정보실', '정비', '한전', '구청', '구청장', '주변',
  '전략', '정책', '조달', '노무', '문화', '주거', '전문',
  '이미', '이제', '이따', '이후', '이쪽', '전에', '우선', '주로', '서로', '오래', '정말', '한번', '한동안', '오히려',
  '오신', '주신', '하신', '오는', '하는', '주는', '이상한', '고마운', '이름',
]);
/** 이름이 직함으로 «끝나면»(또는 직함 그 자체이면) 사람 이름이 아니다:
 *  정교수님·정부장학생·주임님(주+임으로 오분해)·박사님·주무관님 …. */
const TITLE_TAILS = [
  '교수', '선생', '박사', '조교', '연구원', '주임', '대리', '과장', '팀장', '부장', '처장',
  '학생', '차장', '실장', '원장', '소장', '국장', '사장', '이사', '기사', '여사',
  '강사', '주무관', '주사',
];
const endsWithTitle = (w) => TITLE_TAILS.some((tail) => w.endsWith(tail));

/** 이름 끝 글자로 거르기.
 *  NOT_NAME_END — 사람 이름 끝으로 쓰지 않는 글자. 시간(최근에)·부서(전기팀·전산과·학생처)·장소(식당·정문앞)·
 *    꾸밈말(신속히·오는) 끝에 온다. 어느 규칙에서든 이름으로 보지 않는다.
 *  RARE_NAME_END — 장소·단체·꾸밈말 끝에 흔하지만 이름 끝에도 드물게 오는 글자(은실·영관·미소·지한·영창 …).
 *    넓힌 규칙에서만 막고, 예전 규칙에서는 전처럼 이름으로 본다. 그래서 고치기 전보다 더 새는 이름은 없다.
 *  막아 둔 낱말로 시작하는 세 글자(오늘+은, 전산+원)도 같은 방식으로 넓힌 규칙에서만 막는다(이미진·정수진은 예전 규칙으로 잡힌다).
 *  PLACE_END — 직함 뒤에 붙으면 방 이름이 되는 글자(조교+실, 주임+실). */
const NOT_NAME_END = /[에과처팀당반층앞뒤옆쪽점스슈히는던된]$/;
const RARE_NAME_END = /[실장관소청단부국회한운조창공]$/;
const PLACE_END = /[실장]$/;

function looksLikePersonName(name) {
  if (NAME_STOPWORDS.has(name) || endsWithTitle(name) || NOT_NAME_END.test(name)) return false;
  if (PLACE_END.test(name) && endsWithTitle(name.slice(0, -1))) return false;   // 조교실 조교님
  return true;
}
/** 넓힌 규칙에서는 한 번 더 거른다. 여기서 빠진 것은 예전 규칙 단계에서 전처럼 다시 본다. */
function looksLikePersonNameWide(name, sep, title) {
  if (RARE_NAME_END.test(name)) return false;                       // 전기실 과장님하고, 정비창 과장님하고
  if (NAME_STOPWORDS.has(name.slice(0, 2))) return false;           // 막아 둔 낱말로 시작: 오늘은·전산원·조리원 선생님하고
  if (sep === '' && /[조부]$/.test(name) && title.startsWith('교수')) return false;   // 신관+조교수님
  return true;
}

function emptyHits() {
  return { phone: 0, rrn: 0, email: 0, studentId: 0, name: 0 };
}

/** 찾기는 반각 사본(probe)에서 하고, 바꾸기는 원문(text)에 한다. 둘은 글자 수가 같다. make 가 null 이면 그대로 둔다. */
function replaceBoth(doc, re, make) {
  let text = '';
  let probe = '';
  let last = 0;
  for (const m of doc.probe.matchAll(re)) {
    const rep = make(m);
    if (rep === null) continue;
    text += doc.text.slice(last, m.index) + rep;
    probe += doc.probe.slice(last, m.index) + rep;
    last = m.index + m[0].length;
  }
  doc.text = text + doc.text.slice(last);
  doc.probe = probe + doc.probe.slice(last);
}

const HANGUL_RUN_RE = /[가-힣]+/g;

/**
 * LLM 전송용 비식별. 원문은 반환값 어디에도 담기지 않는다(치환 «건수»만 집계).
 *
 * @param {string} text 접수 원문
 * @returns {{ text: string, hits: { phone:number, rrn:number, email:number, studentId:number, name:number } }}
 */
function maskForLlm(text) {
  const hits = emptyHits();
  if (text === null || text === undefined) return { text: '', hits };
  const src = typeof text === 'string' ? text : String(text);
  if (src === '') return { text: '', hits };
  const doc = { text: tidy(src), probe: '' };
  doc.probe = toHalfWidth(doc.text);

  if (doc.probe.includes('@')) replaceBoth(doc, EMAIL_RE, () => { hits.email += 1; return REPLACEMENT.email; });
  replaceBoth(doc, RRN_RE, () => { hits.rrn += 1; return REPLACEMENT.rrn; });
  replaceBoth(doc, STUDENT_ID_RE, () => { hits.studentId += 1; return REPLACEMENT.studentId; });
  replaceBoth(doc, PHONE_RE, () => { hits.phone += 1; return REPLACEMENT.phone; });

  const found = new Set();
  const maskName = (wide) => ([, name, sep, title]) => {
    if (!looksLikePersonName(name)) return null;
    if (wide && !looksLikePersonNameWide(name, sep, title)) return null;   // 예전 규칙 단계에서 다시 본다
    hits.name += 1;
    if (wide) found.add(name);
    return REPLACEMENT.name + sep + title;
  };
  replaceBoth(doc, NAME_RE, maskName(true));
  replaceBoth(doc, BASIC_NAME_RE, maskName(false));
  // 넓힌 규칙에서 잡힌 이름(세 글자 이상)은 같은 글에서 호칭 없이 다시 나와도 지운다 — "김철수 교수님 … 김철수에게".
  //   두 글자와 예전 규칙에서만 잡힌 것은 하지 않는다. 일반 낱말이 잘못 잡혔을 때 글 전체로 번질 수 있어서다.
  //   다른 낱말 안쪽("홍길동전")은 건드리지 않는다: 이름 뒤가 끝이거나 조사일 때만.
  if (found.size) {
    replaceBoth(doc, HANGUL_RUN_RE, ([run]) => {
      for (let n = Math.min(4, run.length); n >= 3; n -= 1) {
        const rest = run.slice(n);
        if (found.has(run.slice(0, n)) && (rest === '' || PARTICLE_HEAD_RE.test(rest))) {
          hits.name += 1;
          return REPLACEMENT.name + rest;
        }
      }
      return null;
    });
  }

  return { text: doc.text, hits };
}

/** 치환 총 건수(엔벨로프 meta.piiMasked 용). */
function totalHits(hits) {
  if (!hits) return 0;
  return (hits.phone || 0) + (hits.rrn || 0) + (hits.email || 0) + (hits.studentId || 0) + (hits.name || 0);
}

module.exports = {
  maskForLlm,
  totalHits,
  REPLACEMENT,
  // 운영 중 오탐이 보고되면 여기를 늘린다(정규식 수정보다 안전하다).
  NAME_STOPWORDS,
};
