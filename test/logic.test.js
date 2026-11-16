// 실행: node --test
const test = require("node:test");
const assert = require("node:assert");
const L = require("../js/logic.js");
const DATA = require("../data/scholarships.js");

const base = { id: 1, title: "시험 장학금", campus: "공통", deadline: "2026-11-20", rolling: false, lastDeadline: null, source: "본문", method: "직접 신청" };
const item = (r, key) => L.judge(r, {}).items.find((i) => i.key === key);

test("조건이 없는 공고는 아무것도 입력하지 않아도 지원 가능", () => {
  assert.equal(L.judge(base, {}).state, "ok");
});

test("성적 경계값: 기준과 같으면 충족, 0.01 낮으면 다름", () => {
  const r = { ...base, gpaMin: 3.0, gpaBasis: "직전학기" };
  assert.equal(L.judge(r, { gpaLast: 3.0 }).state, "ok");
  assert.equal(L.judge(r, { gpaLast: 2.99 }).state, "no");
});

test("성적 기준이 전체 평점이면 직전 학기 평점으로 판단하지 않는다", () => {
  const r = { ...base, gpaMin: 4.0, gpaBasis: "전체" };
  assert.equal(L.judge(r, { gpaLast: 4.3 }).state, "need");
  assert.equal(L.judge(r, { gpaLast: 4.3, gpaTotal: 3.9 }).state, "no");
});

test("입력하지 않은 항목은 자격 미달이 아니라 확인 필요", () => {
  const r = { ...base, gpaMin: 3.0, sem: [2, 7] };
  const j = L.judge(r, {});
  assert.equal(j.state, "need");
  assert.ok(j.items.every((i) => i.result === "unknown"));
});

test("입력하지 않은 항목의 내 조건은 '입력 안 함'으로 표시", () => {
  const r = { ...base, campus: "글로벌", gpaMin: 2.0, gpaBasis: "직전학기", lowIncome: true, sem: [1, 8], incomeMax: 8 };
  assert.ok(L.judge(r, {}).items.every((i) => i.mine === "입력 안 함"));
});

test("학기 범위", () => {
  const r = { ...base, sem: [4, 4] };
  assert.equal(L.judge(r, { sem: 4 }).state, "ok");
  assert.equal(L.judge(r, { sem: 5 }).state, "no");
});

test("학과 제한이 한 캠퍼스에만 적용되는 경우", () => {
  const r = { ...base, deptAny: ["베트남어과"], deptCampus: "서울" };
  assert.equal(L.judge(r, { campus: "서울", dept: "베트남어과" }).state, "ok");
  assert.equal(L.judge(r, { campus: "서울", dept: "경영학부" }).state, "no");
  assert.equal(L.judge(r, { campus: "글로벌", dept: "경영학부" }).state, "ok");
  assert.equal(L.judge(r, { dept: "경영학부" }).state, "need");
});

test("지역: 맞아도 거주 기준은 원문 확인이 필요하고, 다르면 제외", () => {
  const r = { ...base, regions: ["경상남도 통영시"] };
  assert.equal(L.judge(r, { sido: "경상남도", sgg: "통영시" }).state, "need");
  assert.equal(L.judge(r, { sido: "경상남도", sgg: "거창군" }).state, "no");
  assert.equal(L.judge(r, { sido: "서울특별시" }).state, "no");
  assert.equal(L.judge(r, { sido: "경상남도" }).items[0].result, "unknown");
});

test("해당 사항: 미선택은 확인 필요, '해당 없음'은 다름", () => {
  const r = { ...base, specialsAny: ["북한이탈"] };
  assert.equal(L.judge(r, {}).state, "need");
  assert.equal(L.judge(r, { specialsNone: true }).state, "no");
  assert.equal(L.judge(r, { specials: ["북한이탈"] }).state, "ok");
});

test("조건이 첨부파일에만 있는 공고는 지원 가능으로 표시하지 않는다", () => {
  assert.equal(L.judge({ ...base, source: "첨부" }, { sem: 3, gpaLast: 4.5 }).state, "need");
});

test("가계곤란 심사가 있는 공고는 지원구간을 입력해도 확인 필요", () => {
  assert.equal(L.judge({ ...base, lowIncome: true }, { income: 1 }).state, "need");
  assert.equal(item({ ...base, lowIncome: true }, "lowIncome").result, "check");
});

test("마감: 당일까지 모집 중, 다음 날부터 마감", () => {
  assert.equal(L.isOpen(base, new Date(2026, 10, 20, 23, 0)), true);
  assert.equal(L.dday(base, new Date(2026, 10, 20, 9, 0)), 0);
  assert.equal(L.isOpen(base, new Date(2026, 10, 21)), false);
  assert.equal(L.isOpen({ ...base, deadline: null, rolling: true }, new Date(2030, 0, 1)), true);
});

test("체크리스트: 학교 추천과 제출 서류 반영", () => {
  const keys = L.checklist({ ...base, method: "학교 추천", docs: ["성적증명서"] }).map((c) => c.key);
  assert.deepEqual(keys, ["read", "recommend", "doc0", "submit"]);
  assert.ok(L.checklist(base).some((c) => c.key === "docs"));
});

test("캘린더 파일: 확정 마감과 면접 예정 기간을 구분", () => {
  const r = { ...base, interview: { label: "2월 둘째 주 예정", start: "2027-02-08", end: "2027-02-14" } };
  const ics = L.buildICS(r, "https://example.com/a,b", new Date(2026, 10, 16));
  assert.match(ics, /DTSTART;VALUE=DATE:20261120\r\nDTEND;VALUE=DATE:20261121/);
  assert.match(ics, /STATUS:CONFIRMED/);
  assert.match(ics, /DTSTART;VALUE=DATE:20270208\r\nDTEND;VALUE=DATE:20270215/);
  assert.match(ics, /STATUS:TENTATIVE/);
  assert.match(ics, /a\\,b/);
});

test("데이터 파일: 필수 항목과 형식", () => {
  const ids = new Set();
  for (const r of DATA.items) {
    assert.ok(Number.isInteger(r.id) && !ids.has(r.id), `id 중복 또는 형식 오류: ${r.id}`);
    ids.add(r.id);
    for (const k of ["title", "provider", "cat", "campus", "source", "collectedAt"]) assert.ok(r[k], `${r.id}: ${k} 없음`);
    assert.ok(["본문", "첨부"].includes(r.source), `${r.id}: source`);
    assert.ok(["공통", "서울", "글로벌"].includes(r.campus), `${r.id}: campus`);
    assert.ok(r.rolling || r.deadline || r.lastDeadline, `${r.id}: 마감 정보 없음`);
    for (const k of ["deadline", "lastDeadline", "applyStart"]) if (r[k]) assert.match(r[k], /^\d{4}-\d{2}-\d{2}$/, `${r.id}: ${k}`);
    if (r.sem) assert.ok(r.sem.length === 2 && r.sem[0] <= r.sem[1], `${r.id}: sem`);
    L.judge(r, {});
  }
});
