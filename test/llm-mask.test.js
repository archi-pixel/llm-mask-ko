'use strict';
/**
 * llm-mask.test.js — LLM 전송 전 개인정보 마스킹 검사 (llm-mask.js)
 *
 * ★테스트 데이터는 전부 가짜다. 실재 번호·실재 인물 이름을 넣지 말 것
 *   (테스트 파일도 저장소에 남고, 저장소는 개인정보 보관 장소가 아니다).
 *
 * 이 파일의 절반은 «지워지면 안 되는 것» 검사다. 오탐이 나면 위치·증상이 사라져 분류가 틀린다.
 */
const test = require('node:test');
const assert = require('node:assert');

const maskMod = require('../llm-mask');
const { maskForLlm } = maskMod;

// ─────────────────────────────────────────────────────────────────────────────
// 1. 전화 (양성)
// ─────────────────────────────────────────────────────────────────────────────
test('전화 — 휴대전화 하이픈/무하이픈/공백·점 구분', () => {
  const a = maskForLlm('연락처 010-1234-5678 입니다');
  assert.strictEqual(a.text, '연락처 [전화] 입니다');
  assert.strictEqual(a.hits.phone, 1);

  const b = maskForLlm('01012345678 로 전화주세요');
  assert.strictEqual(b.text, '[전화] 로 전화주세요');
  assert.strictEqual(b.hits.phone, 1);

  const c = maskForLlm('010 9876 5432 / 010.5555.6666');
  assert.strictEqual(c.text, '[전화] / [전화]');
  assert.strictEqual(c.hits.phone, 2);
});

test('전화 — 일반전화(지역번호 2~3자리)', () => {
  const a = maskForLlm('사무실 031-290-5115 입니다');
  assert.strictEqual(a.text, '사무실 [전화] 입니다');

  const b = maskForLlm('02-760-1234 로 연락바랍니다');
  assert.strictEqual(b.text, '[전화] 로 연락바랍니다');

  const c = maskForLlm('0212345678 도 됩니다');
  assert.strictEqual(c.text, '[전화] 도 됩니다');
});

test('전화 — 안심번호(0507)·인터넷전화(070)', () => {
  const a = maskForLlm('0507-1234-5678');
  assert.strictEqual(a.text, '[전화]');

  const b = maskForLlm('070-8888-9999 부재중');
  assert.strictEqual(b.text, '[전화] 부재중');

  const c = maskForLlm('연락처는 0505-111-2222 입니다');
  assert.strictEqual(c.text, '연락처는 [전화] 입니다');
});

test('전화 — 국내 사무실 표기(닫는 괄호)', () => {
  const a = maskForLlm('문의 02)760-1234');
  assert.strictEqual(a.text, '문의 [전화]');

  const b = maskForLlm('031)290-5115 내선');
  assert.strictEqual(b.text, '[전화] 내선');

  const c = maskForLlm('(02) 760-1234 로 연락바랍니다');
  assert.strictEqual(c.text, '([전화] 로 연락바랍니다');
  assert.strictEqual(c.hits.phone, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. 주민등록번호 (양성)
// ─────────────────────────────────────────────────────────────────────────────
test('주민등록번호 — 하이픈 있음', () => {
  const r = maskForLlm('신원확인용 900101-1234567 첨부');
  assert.strictEqual(r.text, '신원확인용 [주민번호] 첨부');
  assert.strictEqual(r.hits.rrn, 1);
  assert.strictEqual(r.hits.phone, 0, '주민번호가 전화로 잘려 나가면 안 된다');
});

test('주민등록번호 — 하이픈 없음(13자리 연속)', () => {
  const r = maskForLlm('0512313456789 라고 적혀있습니다');
  assert.strictEqual(r.text, '[주민번호] 라고 적혀있습니다');
  assert.strictEqual(r.hits.rrn, 1);
  assert.strictEqual(r.hits.phone, 0);
});

test('주민등록번호 — 2000년대 출생(성별코드 3·4)·여러 건', () => {
  const a = maskForLlm('050101-3234567');
  assert.strictEqual(a.text, '[주민번호]');

  const b = maskForLlm('본인 880303-2111111, 배우자 900404-4222222');
  assert.strictEqual(b.text, '본인 [주민번호], 배우자 [주민번호]');
  assert.strictEqual(b.hits.rrn, 2);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. 이메일 (양성)
// ─────────────────────────────────────────────────────────────────────────────
test('이메일 — 일반/서브도메인/숫자 로컬파트', () => {
  const a = maskForLlm('회신은 test.user@example.com 으로');
  assert.strictEqual(a.text, '회신은 [메일] 으로');
  assert.strictEqual(a.hits.email, 1);

  const b = maskForLlm('gildong+fms@mail.example.co.kr 확인바랍니다');
  assert.strictEqual(b.text, '[메일] 확인바랍니다');

  const c = maskForLlm('2026012345@example.ac.kr 로 보내주세요');
  assert.strictEqual(c.text, '[메일] 로 보내주세요');
  assert.strictEqual(c.hits.email, 1);
  assert.ok(!c.text.includes('example.ac.kr'), '도메인도 남으면 안 된다');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. 학번 (양성)
// ─────────────────────────────────────────────────────────────────────────────
test('학번 — 20으로 시작하는 10자리', () => {
  const a = maskForLlm('학번 2019123456 입니다');
  assert.strictEqual(a.text, '학번 [학번] 입니다');
  assert.strictEqual(a.hits.studentId, 1);

  const b = maskForLlm('2026054321 신청합니다');
  assert.strictEqual(b.text, '[학번] 신청합니다');

  const c = maskForLlm('학번(2021999888) 확인 부탁드립니다');
  assert.strictEqual(c.text, '학번([학번]) 확인 부탁드립니다');
  assert.strictEqual(c.hits.studentId, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. 이름 + 호칭 (양성)
// ─────────────────────────────────────────────────────────────────────────────
test('이름 — 교수/선생/학생 호칭', () => {
  const a = maskForLlm('김철수 교수님 연구실입니다');
  assert.strictEqual(a.text, '[이름] 교수님 연구실입니다');
  assert.strictEqual(a.hits.name, 1);

  const b = maskForLlm('박영희 선생님께 전달바랍니다');
  assert.strictEqual(b.text, '[이름] 선생님께 전달바랍니다');

  const c = maskForLlm('최민준 학생 사물함');
  assert.strictEqual(c.text, '[이름] 학생 사물함');
});

test('이름 — 님/씨/직함 호칭, 붙여쓴 형태', () => {
  const a = maskForLlm('홍길동님께 회신 부탁드립니다');
  assert.strictEqual(a.text, '[이름]님께 회신 부탁드립니다');

  const b = maskForLlm('신고자 이수진씨');
  assert.strictEqual(b.text, '신고자 [이름]씨');

  const c = maskForLlm('남궁민수 팀장이 확인했습니다');
  assert.strictEqual(c.text, '[이름] 팀장이 확인했습니다', '2자 성씨(남궁) + 2자 이름');
});

test('이름 — 호칭이 없으면 건드리지 않는다(보수적 규칙)', () => {
  const a = maskForLlm('김철수 010-1234-5678');
  assert.strictEqual(a.text, '김철수 [전화]');
  assert.strictEqual(a.hits.name, 0);

  const b = maskForLlm('담당자 정하늘 확인요망');
  assert.strictEqual(b.hits.name, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. 위양성 방지 — 지워지면 «안 되는» 것들
// ─────────────────────────────────────────────────────────────────────────────
test('위양성 1 — 호실 번호는 그대로', () => {
  const a = maskForLlm('제2공학관 27501호 에어컨 고장');
  assert.strictEqual(a.text, '제2공학관 27501호 에어컨 고장');
  assert.strictEqual(maskMod.totalHits(a.hits), 0);

  const b = maskForLlm('23113호 형광등이 나갔습니다');
  assert.strictEqual(b.text, '23113호 형광등이 나갔습니다');
});

test('위양성 2 — 연도는 그대로', () => {
  const r = maskForLlm('2026년 2학기부터 계속 그렇습니다');
  assert.strictEqual(r.text, '2026년 2학기부터 계속 그렇습니다');
  assert.strictEqual(maskMod.totalHits(r.hits), 0);
});

test('위양성 3 — 금액은 그대로', () => {
  const a = maskForLlm('수리비 1,500,000원 견적');
  assert.strictEqual(a.text, '수리비 1,500,000원 견적');

  const b = maskForLlm('150만원 / 15000000원 예산');
  assert.strictEqual(b.text, '150만원 / 15000000원 예산');
  assert.strictEqual(maskMod.totalHits(b.hits), 0);
});

test('위양성 4 — 건물 동 번호·층수는 그대로', () => {
  const r = maskForLlm('3동 5층 복도 천장에서 물이 떨어집니다');
  assert.strictEqual(r.text, '3동 5층 복도 천장에서 물이 떨어집니다');
  assert.strictEqual(maskMod.totalHits(r.hits), 0);
});

test('위양성 5 — 날짜는 그대로', () => {
  const a = maskForLlm('2026-08-26 부터 증상이 있습니다');
  assert.strictEqual(a.text, '2026-08-26 부터 증상이 있습니다');

  const b = maskForLlm('2026.08.26 / 20260826 확인');
  assert.strictEqual(b.text, '2026.08.26 / 20260826 확인');
  assert.strictEqual(maskMod.totalHits(b.hits), 0);
});

test('위양성 6 — 접수번호 형태는 그대로', () => {
  const r = maskForLlm('접수번호 FR-20260826-001 조회했습니다');
  assert.strictEqual(r.text, '접수번호 FR-20260826-001 조회했습니다');
  assert.strictEqual(maskMod.totalHits(r.hits), 0);
});

test('위양성 7 — 시간은 그대로', () => {
  const r = maskForLlm('14:30 경, 09:05 에도 동일 증상');
  assert.strictEqual(r.text, '14:30 경, 09:05 에도 동일 증상');
  assert.strictEqual(maskMod.totalHits(r.hits), 0);
});

test('위양성 8 — 호칭처럼 보이는 일반명사는 이름이 아니다', () => {
  const cases = [
    '고객님 응대 관련 문의드립니다',
    '엘리베이터 기사님이 다녀갔습니다',
    '이과대학 학생 휴게실 청소 요청',
    '강의실 학생 책상이 파손됐습니다',
    '안전 팀장 확인 요청',
    '고등학생 단체 방문 예정입니다',
    '장애학생 지원 관련 문의',
    '전기 과장 부재중이었습니다',
  ];
  for (const s of cases) {
    const r = maskForLlm(s);
    assert.strictEqual(r.text, s, `오탐: ${s}`);
    assert.strictEqual(r.hits.name, 0, `오탐: ${s}`);
  }
});

test('위양성 8-2 — 이름 없는 직함 호칭만 있으면 지우지 않는다', () => {
  // 성씨 1자로 오분해되기 쉬운 것들: 주임님(주+임), 박사님(박+사), 조교님(조+교), 정교수님(정+교수)
  const cases = [
    '시설팀 주임님께 전달했습니다',
    '박사님 연구실 조명 교체 요청',
    '조교님이 신고했습니다',
    '정교수님 연구실 에어컨',
    '홍보팀장님 결재 대기중',
    '차장님 부재중',
  ];
  for (const s of cases) {
    const r = maskForLlm(s);
    assert.strictEqual(r.text, s, `오탐: ${s}`);
    assert.strictEqual(r.hits.name, 0, `오탐: ${s}`);
  }
});

test('위양성 11 — 괄호가 섞인 번호 매김·측정값은 전화가 아니다', () => {
  const cases = [
    '항목 1) 0층 조명 점검',
    '온도가 0도까지 떨어집니다',
    '계량기 번호 0123456 확인',
    '엘리베이터 번호 27-501',
  ];
  for (const s of cases) {
    const r = maskForLlm(s);
    assert.strictEqual(r.text, s, `오탐: ${s}`);
  }
});

test('위양성 9 — 학생회관/학생증처럼 호칭 뒤에 낱말이 붙으면 이름이 아니다', () => {
  const a = maskForLlm('학생회관 2층 화장실 누수');
  assert.strictEqual(a.text, '학생회관 2층 화장실 누수');

  const b = maskForLlm('김철수 학생회 사무실 문이 안 잠깁니다');
  assert.strictEqual(b.hits.name, 0, '뒤에 "회"가 붙으면 호칭이 아니다');
});

test('위양성 10 — 학번 길이(10자리)와 전화 길이(11자리)를 혼동하지 않는다', () => {
  const a = maskForLlm('2019123456');           // 10자리 학번
  assert.deepStrictEqual([a.hits.studentId, a.hits.phone], [1, 0]);

  const b = maskForLlm('01012345678');          // 11자리 전화
  assert.deepStrictEqual([b.hits.studentId, b.hits.phone], [0, 1]);

  const c = maskForLlm('2020123456789');        // 13자리 → 주민번호 규칙만
  assert.deepStrictEqual([c.hits.rrn, c.hits.studentId, c.hits.phone], [1, 0, 0]);
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. 혼합 문장 — 실제 민원처럼 생긴 문장에서 «연락처만» 지워지는지
// ─────────────────────────────────────────────────────────────────────────────
test('혼합 1 — 전화 + 호실 + 증상: 전화만 지워지고 분류 근거는 남는다', () => {
  const src = '제2공학관 27501호 에어컨에서 물이 떨어집니다. 연락처 010-1234-5678 입니다.';
  const r = maskForLlm(src);
  assert.strictEqual(
    r.text,
    '제2공학관 27501호 에어컨에서 물이 떨어집니다. 연락처 [전화] 입니다.',
  );
  assert.strictEqual(r.hits.phone, 1);
  assert.strictEqual(maskMod.totalHits(r.hits), 1);
  for (const keep of ['제2공학관', '27501호', '에어컨', '물이 떨어집니다']) {
    assert.ok(r.text.includes(keep), `분류 근거 소실: ${keep}`);
  }
});

test('혼합 2 — 전화·메일·학번·이름이 섞인 접수 원문', () => {
  const src = [
    '2026년 8월 26일 14:30경 23113호 형광등 2개가 나갔습니다.',
    '3동 5층이고 수리비 1,500,000원 견적 받았습니다.',
    '김철수 교수님 연구실이며 연락처는 031-290-5115, 010-9876-5432 입니다.',
    '메일 test.user@example.com, 학번 2019123456 입니다.',
  ].join('\n');
  const r = maskForLlm(src);

  // 지워져야 하는 것
  for (const gone of ['031-290-5115', '010-9876-5432', 'test.user@example.com', '2019123456', '김철수']) {
    assert.ok(!r.text.includes(gone), `전송본에 남았다: ${gone}`);
  }
  // 남아야 하는 것(분류 근거)
  for (const keep of ['2026년', '14:30', '23113호', '형광등', '3동 5층', '1,500,000원', '교수님']) {
    assert.ok(r.text.includes(keep), `분류 근거 소실: ${keep}`);
  }
  assert.deepStrictEqual(r.hits, { phone: 2, rrn: 0, email: 1, studentId: 1, name: 1 });
  assert.strictEqual(maskMod.totalHits(r.hits), 5);
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. 빈 입력 방어
// ─────────────────────────────────────────────────────────────────────────────
test('빈 입력·null·undefined 방어', () => {
  const zero = { phone: 0, rrn: 0, email: 0, studentId: 0, name: 0 };
  for (const v of ['', null, undefined]) {
    const r = maskForLlm(v);
    assert.strictEqual(r.text, '');
    assert.deepStrictEqual(r.hits, zero);
  }
  assert.strictEqual(maskMod.totalHits(null), 0);
});

test('반환값에 원문 개인정보가 담기지 않는다(hits는 숫자만)', () => {
  const r = maskForLlm('010-1234-5678 김철수 교수님');
  assert.ok(!JSON.stringify(r.hits).includes('010'));
  for (const v of Object.values(r.hits)) assert.strictEqual(typeof v, 'number');
});


// ─────────────────────────────────────────────────────────────────────────────
// 추가(2026-09-07 검수) — 호칭 뒤에 서술격 어미가 붙는 흔한 민원 문장
// ─────────────────────────────────────────────────────────────────────────────
test('이름 — 호칭 뒤 서술격 어미(입니다/이고/인데)도 잡는다', () => {
  assert.strictEqual(maskForLlm('김철수 학생입니다. 27501호 형광등 고장').text, '[이름] 학생입니다. 27501호 형광등 고장');
  assert.strictEqual(maskForLlm('홍길동 교수님이고 연구실은 3층').text, '[이름] 교수님이고 연구실은 3층');
  assert.strictEqual(maskForLlm('박민수님인데 문이 안 잠깁니다').text, '[이름]님인데 문이 안 잠깁니다');
  assert.strictEqual(maskForLlm('이영희 조교입니다').hits.name, 1);
});

test('이름 — 어미 확장 뒤에도 일반명사 오탐 없음', () => {
  for (const s of ['학생회관 입구', '강의실 학생입니다만', '이과대학 학생인데요', '정문 앞 주차', '전기실 담당자입니다']) {
    assert.strictEqual(maskForLlm(s).text, s, s);
  }
});
