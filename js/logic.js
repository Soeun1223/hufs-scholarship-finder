// 조건 비교, 마감 계산, 체크리스트, 캘린더 파일 생성.
// 화면과 분리된 순수 함수라서 node --test 로 검증할 수 있다.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Logic = factory();
})(this, function () {
  const DAY = 864e5;

  const parseD = (s) => {
    if (!s) return null;
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  // 마감까지 남은 날 수. 상시 모집이거나 마감일이 없으면 null.
  function dday(r, today) {
    if (r.rolling || !r.deadline) return null;
    return Math.round((parseD(r.deadline) - startOf(today)) / DAY);
  }

  function isOpen(r, today) {
    if (r.lastDeadline) return false;
    if (r.rolling) return true;
    const d = dday(r, today);
    return d !== null && d >= 0;
  }

  // 지난 공고의 마감일 (처음부터 지난 공고로 등록됐거나, 모집 중이다가 마감된 경우)
  const closedOn = (r) => r.lastDeadline || r.deadline || null;

  const has = (v) => v !== null && v !== undefined && v !== "";

  // 공고 r 의 지원 요건과 학생 조건 p 를 항목별로 비교한다.
  // 항목 결과: pass(충족) / fail(다름) / unknown(학생이 입력하지 않음) / check(자동 판단 불가, 원문 확인)
  // 전체 상태: ok(지원 가능, 입력 조건 기준) / need(추가 확인 필요) / no(현재 조건과 다름)
  function judge(r, p) {
    const items = [];
    const add = (key, label, need, mine, result, note) =>
      items.push({ key, label, need, mine: has(mine) ? String(mine) : "입력 안 함", result, note: note || "" });

    if (r.campus && r.campus !== "공통") {
      add("campus", "캠퍼스", `${r.campus}캠퍼스`, p.campus && `${p.campus}캠퍼스`,
        !has(p.campus) ? "unknown" : p.campus === r.campus ? "pass" : "fail");
    }

    if (r.deptAny && r.deptAny.length) {
      const scope = r.deptCampus ? `${r.deptCampus}캠퍼스는 ` : "";
      const need = `${scope}${r.deptAny.join(", ")}`;
      let result;
      if (r.deptCampus && !has(p.campus)) result = "unknown";
      else if (r.deptCampus && p.campus !== r.deptCampus) result = "pass"; // 학과 제한이 없는 캠퍼스
      else if (!has(p.dept)) result = "unknown";
      else result = r.deptAny.includes(p.dept.trim()) ? "pass" : "fail";
      add("dept", "학과", need, p.dept, result);
    }

    if (r.sem) {
      const [a, b] = r.sem;
      add("sem", "학기", a === b ? `${a}학기 재학` : `${a}~${b}학기 재학`, has(p.sem) && `${p.sem}학기`,
        !has(p.sem) ? "unknown" : p.sem >= a && p.sem <= b ? "pass" : "fail");
    }

    if (has(r.gpaMin)) {
      const basis = r.gpaBasis;
      const mine = basis === "전체" ? p.gpaTotal : basis === "직전학기" ? p.gpaLast : has(p.gpaLast) ? p.gpaLast : p.gpaTotal;
      const label = basis ? `성적 (${basis} 평점)` : "성적 (평점)";
      add("gpa", label, `${r.gpaMin.toFixed(1)} 이상`, has(mine) && Number(mine).toFixed(2),
        !has(mine) ? "unknown" : Number(mine) >= r.gpaMin ? "pass" : "fail",
        basis ? "" : "직전 학기 기준인지 전체 기준인지는 원문에서 확인하세요");
    }

    if (has(r.incomeMax)) {
      add("income", "학자금 지원구간", `${r.incomeMax}구간 이하`, has(p.income) && `${p.income}구간`,
        !has(p.income) ? "unknown" : p.income <= r.incomeMax ? "pass" : "fail");
    }

    if (r.lowIncome) {
      add("lowIncome", "가계 사정", "가계곤란 심사 있음", has(p.income) && `${p.income}구간`, "check",
        "기준 구간과 증빙 서류는 원문에서 확인하세요");
    }

    if (r.regions && r.regions.length) {
      const mine = [p.sido, p.sgg].filter(has).join(" ");
      let result;
      if (!has(p.sido)) result = "unknown";
      else {
        const sameSido = r.regions.filter((g) => g.split(" ")[0] === p.sido);
        if (!sameSido.length) result = "fail";
        else if (sameSido.some((g) => !g.split(" ")[1])) result = "check";
        else if (!has(p.sgg)) result = "unknown";
        else result = sameSido.some((g) => g.split(" ")[1] === p.sgg.trim()) ? "check" : "fail";
      }
      add("region", "지역", r.regions.join(", "), mine, result,
        result === "check" ? "지역은 맞아요. 출신지·현재 거주지 중 무엇이 기준인지와 거주기간은 원문에서 확인하세요" : "");
    }

    if (r.specialsAny && r.specialsAny.length) {
      const mine = p.specials || [];
      const hit = mine.some((s) => r.specialsAny.includes(s));
      add("special", "해당 사항", `${r.specialsAny.join(", ")} 중 하나`, mine.length ? mine.join(", ") : p.specialsNone ? "해당 없음" : "",
        hit ? "pass" : p.specialsNone || mine.length ? "fail" : "unknown");
    }

    if (r.source === "첨부") {
      items.push({ key: "attach", label: "세부 조건", need: "첨부파일에만 있음", mine: "-", result: "check",
        note: "이 공고의 조건은 첨부파일에만 있어 아직 정리되지 않았어요. 원문을 확인하세요" });
    }

    const state = items.some((i) => i.result === "fail") ? "no"
      : items.some((i) => i.result === "unknown" || i.result === "check") ? "need" : "ok";
    return { state, items };
  }

  // 목표 성적·지원구간을 가정했을 때 새로 충족하게 되는 요건 (현재는 다름 -> 가정하면 충족)
  function newlyMet(r, p, target) {
    const before = judge(r, p).items;
    const q = Object.assign({}, p);
    if (has(target.gpa)) { q.gpaLast = target.gpa; q.gpaTotal = target.gpa; }
    if (has(target.income)) q.income = target.income;
    const after = judge(r, q).items;
    return after.filter((a) => {
      const b = before.find((x) => x.key === a.key);
      return (a.key === "gpa" || a.key === "income") && a.result === "pass" && b && b.result !== "pass";
    });
  }

  // 신청 준비 체크리스트. 공고에 적힌 내용만으로 만든다.
  function checklist(r) {
    const list = [{ key: "read", text: "원문 공고와 첨부파일 끝까지 읽기" }];
    if (r.method === "학교 추천") list.push({ key: "recommend", text: "학교 추천 절차와 교내 접수 마감 확인" });
    if (r.docs && r.docs.length) r.docs.forEach((d, i) => list.push({ key: `doc${i}`, text: `${d} 준비` }));
    else list.push({ key: "docs", text: "제출 서류 목록 확인 (원문)" });
    list.push({ key: "submit", text: "신청서 제출" });
    return list;
  }

  // 캘린더에 넣을 일정. 확정 일정과 예정 기간을 구분한다.
  function calEvents(r) {
    const ev = [];
    if (r.deadline && !r.rolling) ev.push({ title: `[마감] ${r.title}`, start: r.deadline, end: r.deadline, tentative: false });
    (r.routes || []).forEach((t) => {
      if (t.deadline) ev.push({ title: `[${t.label} 마감] ${r.title}`, start: t.deadline, end: t.deadline, tentative: false });
    });
    if (r.interview && r.interview.start) {
      const range = r.interview.end && r.interview.end !== r.interview.start;
      ev.push({ title: `[${range ? "면접 예정 기간" : "면접"}] ${r.title}`, start: r.interview.start,
        end: r.interview.end || r.interview.start, tentative: range, note: r.interview.label });
    }
    return ev;
  }

  const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const icsEsc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

  function buildICS(r, url, now) {
    const stamp = `${ymd(now)}T000000Z`;
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//HUFS Janghakbom//KO", "CALSCALE:GREGORIAN"];
    calEvents(r).forEach((e, i) => {
      const end = parseD(e.end);
      end.setDate(end.getDate() + 1); // 종일 일정의 종료일은 다음 날
      lines.push("BEGIN:VEVENT", `UID:hjb-${r.id}-${i}@janghakbom`, `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${ymd(parseD(e.start))}`, `DTEND;VALUE=DATE:${ymd(end)}`,
        `SUMMARY:${icsEsc(e.title)}`,
        `DESCRIPTION:${icsEsc([e.note, e.tentative ? "정확한 날짜는 원문에서 확인하세요." : "", `원문 공고: ${url}`].filter(Boolean).join("\n"))}`,
        `STATUS:${e.tentative ? "TENTATIVE" : "CONFIRMED"}`, "END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n") + "\r\n";
  }

  return { parseD, dday, isOpen, closedOn, judge, newlyMet, checklist, calEvents, buildICS };
});
