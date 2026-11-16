// 화면 그리기와 사용자 입력 처리. 조건 비교는 logic.js, 공고는 data/scholarships.js.
(function () {
  const { meta, items } = window.HSF_DATA;
  const L = window.Logic;
  const TODAY = new Date();
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const boardUrl = (id) => `https://student.hufs.ac.kr/bbs/student/2431/${id}/artclView.do`;
  const fmt = (s) => { const d = L.parseD(s); return d ? `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}` : ""; };
  const short = (s) => { const d = L.parseD(s); return `${d.getMonth() + 1}/${d.getDate()}`; };

  // 저장소: 관심 목록과 체크리스트는 항상, 개인 조건은 사용자가 켰을 때만 이 기기에 저장한다.
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 환경에서는 무시 */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* 무시 */ } },
  };
  const favs = new Set(store.get("hsf-favs", []));
  const checks = store.get("hsf-checks", {}); // { [id]: { done: [key], custom: [text] } }
  let applied = {};
  let filter = { cat: "전체", campus: "전체", soon: false, rolling: false, recommend: false };
  let calMonth = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);

  const SIDO = ["서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시", "대전광역시", "울산광역시", "세종특별자치시", "경기도", "강원특별자치도", "충청북도", "충청남도", "전북특별자치도", "전라남도", "경상북도", "경상남도", "제주특별자치도"];
  const uniq = (a) => [...new Set(a)];
  const SPECIALS = uniq(["기초생활수급", "차상위", "경제사정 곤란", "다자녀", "다문화", "장애", "국가보훈", ...items.flatMap((r) => r.specialsAny || [])]);

  const open = () => items.filter((r) => L.isOpen(r, TODAY)).sort(byDeadline);
  const past = () => items.filter((r) => !L.isOpen(r, TODAY)).sort((a, b) => L.parseD(L.closedOn(b)) - L.parseD(L.closedOn(a)));
  function byDeadline(a, b) {
    const d = (r) => (r.rolling ? 9999 : L.dday(r, TODAY));
    return d(a) - d(b);
  }

  // ── 폼 준비 ──
  function initForm() {
    const f = $("#profile");
    for (let i = 1; i <= 10; i++) f.sem.add(new Option(`${i}학기`, i));
    for (let i = 0; i <= 10; i++) {
      const label = i === 0 ? "기초·차상위" : `${i}구간`;
      f.income.add(new Option(label, i));
      $("#t-income").add(new Option(label, i));
    }
    SIDO.forEach((s) => f.sido.add(new Option(s)));
    $("#dl-dept").innerHTML = uniq(items.flatMap((r) => r.deptAny || [])).map((d) => `<option value="${esc(d)}">`).join("");
    $("#dl-sgg").innerHTML = uniq(items.flatMap((r) => r.regions || []).map((g) => g.split(" ")[1]).filter(Boolean)).map((d) => `<option value="${esc(d)}">`).join("");
    $("#specials").innerHTML = SPECIALS.map((s) => `<label class="check"><input type="checkbox" name="special" value="${esc(s)}"> ${esc(s)}</label>`).join("");
    $("#sem-basis").textContent = `(${meta.semBasis})`;
    $("#snap").textContent = `공고 수집일 ${fmt(meta.collectedAt)}`;
    $("#board").href = meta.board;

    const saved = store.get("hsf-profile", null);
    if (saved) { fillForm(saved); f.remember.checked = true; applied = saved; }

    f.addEventListener("submit", (e) => {
      e.preventDefault();
      applied = readForm();
      if (f.remember.checked) store.set("hsf-profile", applied); else store.del("hsf-profile");
      renderAll();
      // 좁은 화면에서는 결과가 폼 아래에 있으므로 결과로 이동한다.
      if (window.matchMedia("(max-width: 820px)").matches) $("#applied").scrollIntoView({ behavior: "smooth" });
    });
    f.remember.addEventListener("change", () => { if (!f.remember.checked) store.del("hsf-profile"); });
    $("#clear").addEventListener("click", () => { f.reset(); store.del("hsf-profile"); applied = {}; renderAll(); });
    $("#t-gpa").addEventListener("input", renderSim);
    $("#t-income").addEventListener("change", renderSim);
  }

  const num = (v) => (v === "" || v == null ? null : Number(v));
  function readForm() {
    const f = $("#profile");
    return {
      campus: f.campus.value, dept: f.dept.value.trim(), sem: num(f.sem.value),
      gpaLast: num(f.gpaLast.value), gpaTotal: num(f.gpaTotal.value), income: num(f.income.value),
      sido: f.sido.value, sgg: f.sgg.value.trim(),
      specials: [...f.querySelectorAll('[name="special"]:checked')].map((c) => c.value),
      specialsNone: f.specialsNone.checked,
    };
  }
  function fillForm(p) {
    const f = $("#profile");
    ["campus", "dept", "sem", "gpaLast", "gpaTotal", "income", "sido", "sgg"].forEach((k) => { f[k].value = p[k] ?? ""; });
    f.querySelectorAll('[name="special"]').forEach((c) => { c.checked = (p.specials || []).includes(c.value); });
    f.specialsNone.checked = !!p.specialsNone;
  }
  function condText(p) {
    const t = [p.campus && `${p.campus}캠퍼스`, p.dept, p.sem && `${p.sem}학기`, p.gpaLast != null && `직전 ${p.gpaLast}`,
      p.gpaTotal != null && `전체 ${p.gpaTotal}`, p.income != null && `${p.income}구간`, [p.sido, p.sgg].filter(Boolean).join(" "),
      ...(p.specials || []), p.specialsNone && "해당 사항 없음"].filter(Boolean);
    return t.length ? `검색에 적용된 조건: ${t.join(" · ")}` : "아직 조건을 입력하지 않았어요. 입력하지 않아도 모집 중인 공고를 모두 볼 수 있어요.";
  }

  // ── 카드 ──
  const STATE = { ok: "지원 가능 (입력 조건 기준)", need: "확인 필요", no: "현재 조건과 다름" };
  function whyText(j) {
    if (j.state === "no") return j.items.filter((i) => i.result === "fail").map((i) => `${i.label}: ${i.need}`).join(" · ");
    if (j.state === "need") {
      const unknown = j.items.filter((i) => i.result === "unknown").map((i) => i.label);
      const check = j.items.filter((i) => i.result === "check").map((i) => i.label);
      return [unknown.length && `입력하면 판단할 수 있어요: ${unknown.join(", ")}`, check.length && `원문 확인: ${check.join(", ")}`].filter(Boolean).join(" / ");
    }
    return "";
  }
  function ddayBox(r) {
    if (!L.isOpen(r, TODAY)) return `<div class="dday past">${short(L.closedOn(r))}<small>마감</small></div>`;
    if (r.rolling) return `<div class="dday">상시<small>모집</small></div>`;
    const d = L.dday(r, TODAY);
    return `<div class="dday${d <= 7 ? " hot" : ""}">${d === 0 ? "오늘" : `D-${d}`}<small>${short(r.deadline)} 마감</small></div>`;
  }
  function card(r, j, extra) {
    const st = !L.isOpen(r, TODAY) && !j ? `<span class="st closed">모집 마감</span>` : j ? `<span class="st ${j.state}">${STATE[j.state]}</span>` : "";
    const why = j ? whyText(j) : "";
    return `<article class="card" data-id="${r.id}" tabindex="0">
      ${ddayBox(r)}
      <div>
        <h3>${esc(r.title)}</h3>
        <p class="meta">${esc(r.provider)} · ${esc(r.cat)} · ${esc(r.campus)} · ${esc(r.method)}</p>
        <p class="amount">${esc(r.amount)}</p>
        ${st}${why ? `<p class="why">${esc(why)}</p>` : ""}${extra || ""}
      </div>
      <button class="star" data-star="${r.id}" aria-pressed="${favs.has(r.id)}" aria-label="관심 장학금 ${favs.has(r.id) ? "해제" : "저장"}">${favs.has(r.id) ? "★" : "☆"}</button>
    </article>`;
  }
  const empty = (t) => `<p class="empty">${esc(t)}</p>`;

  // ── 탭별 목록 ──
  function renderMine() {
    const judged = open().map((r) => ({ r, j: L.judge(r, applied) }));
    const group = (state, title) => {
      const rows = judged.filter((x) => x.j.state === state);
      return rows.length ? `<h2 class="group"><span class="st ${state}">${title}</span> ${rows.length}건</h2>${rows.map((x) => card(x.r, x.j)).join("")}` : "";
    };
    $("#applied").textContent = condText(applied);
    $("#list-mine").innerHTML = judged.length
      ? group("ok", STATE.ok) + group("need", STATE.need) + group("no", STATE.no)
      : empty("지금 모집 중인 공고가 없어요. 지난 장학금 탭에서 다음 모집을 준비해 보세요.");
    $("#c-mine").textContent = judged.filter((x) => x.j.state === "ok").length || "";
    renderSim();
  }

  function renderAllTab() {
    const cats = ["전체", ...uniq(items.map((r) => r.cat))];
    const toggle = (key, label) => `<button data-toggle="${key}" aria-pressed="${filter[key]}">${label}</button>`;
    $("#filters").innerHTML = cats.map((c) => `<button data-cat="${esc(c)}" aria-pressed="${filter.cat === c}">${esc(c)}</button>`).join("")
      + `<span class="sep"></span>`
      + ["전체", "서울", "글로벌"].map((c) => `<button data-campus="${c}" aria-pressed="${filter.campus === c}">${c === "전체" ? "캠퍼스 전체" : `${c}캠퍼스`}</button>`).join("")
      + `<span class="sep"></span>` + toggle("soon", "7일 안에 마감") + toggle("rolling", "상시 모집") + toggle("recommend", "학교 추천 필요");
    const rows = open().filter((r) => (filter.cat === "전체" || r.cat === filter.cat)
      && (filter.campus === "전체" || r.campus === "공통" || r.campus === filter.campus)
      && (!filter.soon || (!r.rolling && L.dday(r, TODAY) <= 7))
      && (!filter.rolling || r.rolling)
      && (!filter.recommend || r.method === "학교 추천"));
    $("#list-all").innerHTML = rows.length ? rows.map((r) => card(r, null)).join("") : empty("조건에 맞는 모집 중 공고가 없어요.");
    $("#c-all").textContent = open().length || "";
  }

  function progress(r) {
    const c = checks[r.id] || { done: [], custom: [] };
    const total = L.checklist(r).length + c.custom.length;
    return `<p class="progress">준비 ${c.done.length}/${total}</p>`;
  }
  function renderFav() {
    const rows = items.filter((r) => favs.has(r.id)).sort((a, b) => L.isOpen(b, TODAY) - L.isOpen(a, TODAY) || byDeadline(a, b));
    $("#list-fav").innerHTML = rows.length
      ? rows.map((r) => card(r, L.isOpen(r, TODAY) ? L.judge(r, applied) : null, progress(r))).join("")
      : empty("관심 있는 장학금의 ☆를 누르면 여기에 모여요. 제출 서류 체크리스트와 캘린더 저장을 쓸 수 있어요.");
    $("#c-fav").textContent = rows.length || "";
  }

  function renderPast() {
    const rows = past();
    $("#list-past").innerHTML = rows.length ? rows.map((r) => card(r, L.judge(r, applied))).join("") : empty("지난 공고가 아직 없어요.");
    $("#c-past").textContent = rows.length || "";
  }

  function renderSim() {
    const target = { gpa: num($("#t-gpa").value), income: num($("#t-income").value) };
    if (target.gpa == null && target.income == null) { $("#sim-out").innerHTML = ""; return; }
    const hit = (rows) => rows.map((r) => ({ r, met: L.newlyMet(r, applied, target) })).filter((x) => x.met.length);
    const line = (x) => `<li><a href="#" data-open="${x.r.id}">${esc(x.r.title)}</a> — ${x.met.map((m) => `${esc(m.label)} ${esc(m.need)}`).join(", ")}</li>`;
    const now = hit(open()), old = hit(past());
    $("#sim-out").innerHTML = `
      <h3>현재 모집 중 ${now.length}건</h3>
      ${now.length ? `<ul>${now.map(line).join("")}</ul><p class="hint">현재 모집에는 공고에서 정한 확정 성적이 적용돼요. 지금 성적으로는 요건과 달라요.</p>` : `<p class="hint">새로 요건을 충족하는 공고가 없어요.</p>`}
      <h3>지난 공고 ${old.length}건</h3>
      ${old.length ? `<ul>${old.map(line).join("")}</ul><p class="hint">지난 모집의 요건이에요. 다음 모집에서는 달라질 수 있어요.</p>` : `<p class="hint">새로 요건을 충족하는 공고가 없어요.</p>`}`;
  }

  // ── 마감 달력 ──
  function renderCal() {
    const y = calMonth.getFullYear(), m = calMonth.getMonth();
    $("#cal-title").textContent = `${y}년 ${m + 1}월`;
    const byDay = {};
    open().forEach((r) => {
      const d = L.parseD(r.deadline);
      if (!r.rolling && d && d.getFullYear() === y && d.getMonth() === m) (byDay[d.getDate()] = byDay[d.getDate()] || []).push(r);
    });
    const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
    const isToday = (d) => y === TODAY.getFullYear() && m === TODAY.getMonth() && d === TODAY.getDate();
    let html = ["일", "월", "화", "수", "목", "금", "토"].map((w) => `<div class="dow">${w}</div>`).join("") + `<div class="pad"></div>`.repeat(first);
    for (let d = 1; d <= days; d++) {
      html += `<div class="day${isToday(d) ? " today" : ""}${byDay[d] ? " has" : ""}"><span class="n">${d}</span>${(byDay[d] || []).map((r) => `<a href="#" data-open="${r.id}">${esc(r.title)}</a>`).join("")}</div>`;
    }
    $("#cal").innerHTML = html;
  }

  function renderAll() { renderMine(); renderAllTab(); renderCal(); renderFav(); renderPast(); }

  // ── 상세 (요건 비교 + 신청 준비) ──
  const RES = { pass: "충족", fail: "다름", unknown: "입력 필요", check: "원문 확인" };
  function openDetail(id) {
    const r = items.find((x) => x.id === id);
    if (!r) return;
    const j = L.judge(r, applied);
    const isOpen = L.isOpen(r, TODAY);
    const c = checks[r.id] || { done: [], custom: [] };
    const todo = [...L.checklist(r), ...c.custom.map((t, i) => ({ key: `c${i}`, text: t, custom: i }))];
    const ev = L.calEvents(r);
    const deadline = r.rolling ? "상시 모집" : isOpen ? `${fmt(r.deadline)}${r.applyStart ? ` (접수 시작 ${fmt(r.applyStart)})` : ""}` : `${fmt(L.closedOn(r))} 마감됨`;
    const routes = (r.routes || []).length
      ? r.routes.map((t) => `<dt>${esc(t.label)}</dt><dd>${t.deadline ? fmt(t.deadline) : "원문 확인"}${t.note ? ` · ${esc(t.note)}` : ""}</dd>`).join("")
      : `<dt>신청 방법</dt><dd>${esc(r.method)}${r.method === "학교 추천" ? " · 교내 접수 마감과 기관의 최종 마감이 다를 수 있어요. 원문에서 확인하세요." : ""}</dd>`;

    $("#detail").innerHTML = `
      <div class="d-head">
        <div><h2 id="d-title">${esc(r.title)}</h2><p class="meta">${esc(r.provider)} · ${esc(r.cat)} · ${esc(r.campus)}</p></div>
        <button data-close aria-label="닫기">닫기</button>
      </div>
      <p><span class="st ${isOpen ? j.state : "closed"}">${isOpen ? STATE[j.state] : "모집 마감"}</span></p>

      <h3>지원 요건과 내 조건</h3>
      ${j.items.length ? `<table><thead><tr><th>항목</th><th>공고 요건</th><th>내 조건</th><th>결과</th></tr></thead><tbody>
        ${j.items.map((i) => `<tr><td>${esc(i.label)}</td><td>${esc(i.need)}${i.note ? `<small>${esc(i.note)}</small>` : ""}</td><td>${esc(i.mine)}</td><td class="res ${i.result}">${RES[i.result]}</td></tr>`).join("")}
      </tbody></table>` : `<p class="hint">정리된 자격 제한이 없어요. 아래 공고 요약과 원문을 확인하세요.</p>`}
      <p class="hint">나이·국적·이수 학점처럼 이 표에 없는 조건은 아래 조건 요약과 원문에서 확인하세요. 서류 심사나 면접 같은 선발 절차도 이 비교에 포함되지 않아요.</p>

      <h3>마감과 신청 경로</h3>
      <dl><dt>마감</dt><dd>${deadline}</dd>${routes}
        ${r.interview ? `<dt>면접</dt><dd>${esc(r.interview.label)}</dd>` : ""}
        ${r.quota ? `<dt>선발 인원</dt><dd>${r.quota}명</dd>` : ""}</dl>

      <h3>공고 요약</h3>
      <dl><dt>지원 금액</dt><dd>${esc(r.amount)}</dd><dt>중복 수혜</dt><dd>${esc(r.dup)}</dd><dt>조건 요약</dt><dd>${esc(r.summary)}</dd>
        <dt>정보 출처</dt><dd>공고 ${esc(r.source)} · ${fmt(r.collectedAt)} 수집</dd></dl>

      <h3>신청 준비 체크리스트</h3>
      <ul class="todo">${todo.map((t) => `<li class="${c.done.includes(t.key) ? "done" : ""}"><input type="checkbox" id="td-${t.key}" data-todo="${t.key}" ${c.done.includes(t.key) ? "checked" : ""}><label for="td-${t.key}"><span>${esc(t.text)}</span></label>${t.custom != null ? `<button data-del="${t.custom}" aria-label="삭제">×</button>` : ""}</li>`).join("")}</ul>
      <form class="addtodo" data-add><input name="t" placeholder="직접 추가 (예: 추천서 부탁드리기)" aria-label="할 일 추가"><button>추가</button></form>

      <div class="actions">
        <button data-star="${r.id}" aria-pressed="${favs.has(r.id)}">${favs.has(r.id) ? "★ 관심 저장됨" : "☆ 관심 장학금 저장"}</button>
        ${ev.length && isOpen ? `<button data-ics>캘린더 파일(.ics) 저장</button>` : ""}
        <a href="${boardUrl(r.id)}" target="_blank" rel="noopener"><button type="button" class="primary">원문 공고 보기</button></a>
      </div>`;
    const dlg = $("#detail");
    dlg.dataset.id = r.id;
    if (!dlg.open) dlg.showModal();
  }

  function saveChecks() { store.set("hsf-checks", checks); renderFav(); }
  function entry(id) { return checks[id] || (checks[id] = { done: [], custom: [] }); }

  function downloadICS(r) {
    const blob = new Blob([L.buildICS(r, boardUrl(r.id), new Date())], { type: "text/calendar;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `외대장학_${r.title.replace(/[\\/:*?"<>|]/g, "")}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function toggleFav(id) {
    if (favs.has(id)) favs.delete(id); else favs.add(id);
    store.set("hsf-favs", [...favs]);
    renderAll();
  }

  // ── 이벤트 ──
  function initEvents() {
    document.querySelectorAll("nav.tabs button").forEach((b) => b.addEventListener("click", () => {
      document.querySelectorAll("nav.tabs button").forEach((x) => x.setAttribute("aria-selected", x === b));
      ["mine", "all", "cal", "fav", "past"].forEach((t) => { $(`#tab-${t}`).hidden = t !== b.dataset.tab; });
    }));

    document.addEventListener("click", (e) => {
      const star = e.target.closest("[data-star]");
      if (star) { e.stopPropagation(); toggleFav(Number(star.dataset.star)); if ($("#detail").open) openDetail(Number($("#detail").dataset.id)); return; }
      const link = e.target.closest("[data-open]");
      if (link) { e.preventDefault(); openDetail(Number(link.dataset.open)); return; }
      const cat = e.target.closest("[data-cat]");
      if (cat) { filter.cat = cat.dataset.cat; renderAllTab(); return; }
      const campus = e.target.closest("[data-campus]");
      if (campus) { filter.campus = campus.dataset.campus; renderAllTab(); return; }
      const tg = e.target.closest("[data-toggle]");
      if (tg) { filter[tg.dataset.toggle] = !filter[tg.dataset.toggle]; renderAllTab(); return; }
      const c = e.target.closest(".card");
      if (c) openDetail(Number(c.dataset.id));
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.classList && e.target.classList.contains("card")) openDetail(Number(e.target.dataset.id));
    });

    $("#cal-prev").addEventListener("click", () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderCal(); });
    $("#cal-next").addEventListener("click", () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderCal(); });

    const dlg = $("#detail");
    dlg.addEventListener("click", (e) => {
      const id = Number(dlg.dataset.id);
      if (e.target === dlg || e.target.closest("[data-close]")) { dlg.close(); return; }
      if (e.target.closest("[data-ics]")) { downloadICS(items.find((x) => x.id === id)); return; }
      const del = e.target.closest("[data-del]");
      if (del) {
        const en = entry(id), i = Number(del.dataset.del);
        en.custom.splice(i, 1);
        // 직접 추가한 항목의 key 는 순서(c0, c1...)라서 삭제하면 뒤 항목의 완료 표시를 한 칸씩 당긴다.
        en.done = en.done.filter((k) => k !== `c${i}`).map((k) => (/^c\d+$/.test(k) && Number(k.slice(1)) > i ? `c${Number(k.slice(1)) - 1}` : k));
        saveChecks(); openDetail(id);
      }
    });
    dlg.addEventListener("change", (e) => {
      const key = e.target.dataset.todo;
      if (!key) return;
      const id = Number(dlg.dataset.id), en = entry(id);
      en.done = e.target.checked ? uniq([...en.done, key]) : en.done.filter((k) => k !== key);
      saveChecks(); openDetail(id);
    });
    dlg.addEventListener("submit", (e) => {
      if (!e.target.matches("[data-add]")) return;
      e.preventDefault();
      const text = e.target.t.value.trim();
      if (!text) return;
      const id = Number(dlg.dataset.id);
      entry(id).custom.push(text);
      saveChecks(); openDetail(id);
    });
  }

  initForm();
  initEvents();
  renderAll();
})();
