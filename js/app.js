(() => {
  "use strict";

  const TERMS = window.TERMS || [];
  const MARKS = ["ア", "イ", "ウ", "エ"];
  const SETTINGS_KEY = "remember.settings";
  const TAGS_KEY = "remember.tags";
  const TAG_NAMES_KEY = "remember.tagNames";
  const FAVORITE = "お気に入り";
  // 最初から用意しているタグ。名前の変更・削除はできない
  const BUILTIN_TAGS = [FAVORITE, "復習"];

  const TIME_OPTIONS = [0, 10, 20, 30, 60]; // 0 = 制限なし

  // 難易度。問題の level に 1〜4 を書く。書いていない問題は「未設定」(0)
  const LEVELS = [
    { value: 1, label: "Lv.1", desc: "ITパスポート" },
    { value: 2, label: "Lv.2", desc: "基本情報技術者" },
    { value: 3, label: "Lv.3", desc: "応用情報技術者" },
    { value: 4, label: "Lv.4", desc: "それ以上の難問" },
    { value: 0, label: "未設定", desc: "難易度なし" },
  ];
  const DEFAULT_SETTINGS = { timeLimit: 0, count: 0, order: "sequential" };

  const app = document.getElementById("app");
  const backBtn = document.getElementById("back-btn");

  // 画面の履歴。戻るボタンで一つ前の画面に戻る
  const history = [];
  let timerId = null;
  let searchQuery = "";

  // ---------- ユーティリティ ----------

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else if (value === true) node.setAttribute(key, "");
      else if (value !== false && value != null) node.setAttribute(key, value);
    }
    for (const child of [].concat(children)) {
      if (child == null) continue;
      node.append(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  }

  // replaceChildren は null を "null" という文字で表示してしまうので取り除いてから入れる
  function setChildren(node, ...children) {
    node.replaceChildren(...children.filter((c) => c != null));
  }

  function shuffle(array) {
    const a = array.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function loadJSON(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 保存できなくてもゲームは続けられる
    }
  }

  function stopTimer() {
    if (timerId) cancelAnimationFrame(timerId);
    timerId = null;
  }

  // ---------- データ ----------

  // 問題に用語と識別キーを持たせる。キーは問題文なので、並び替えてもタグが外れず、
  // 複数の用語に入れた同じ問題はタグを共有する
  for (const term of TERMS) {
    term.items = (term.questions || [])
      .filter((q) => Array.isArray(q.choices) && (q.choices.length === 3 || q.choices.length === 4) && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.choices.length)
      .map((q) => ({ ...q, term, key: q.question }));
  }

  // ジャンル → カテゴリ → 用語 の木を、用語に書かれた名前から作る
  // 用語がまだないジャンル・カテゴリは terms.js の CATEGORIES に書いておくと（用語のあるものの後ろに）表示される
  const GENRES = [];
  function findOrAdd(genreName, categoryName) {
    let genre = GENRES.find((g) => g.name === genreName);
    if (!genre) GENRES.push((genre = { name: genreName, categories: [] }));
    let category = genre.categories.find((c) => c.name === categoryName);
    if (!category) genre.categories.push((category = { name: categoryName, terms: [] }));
    return category;
  }
  for (const term of TERMS) findOrAdd(term.genre, term.category).terms.push(term);
  for (const entry of window.CATEGORIES || []) {
    for (const name of entry.categories || []) findOrAdd(entry.genre, name);
  }

  function levelOf(item) {
    return [1, 2, 3, 4].includes(item.level) ? item.level : 0;
  }

  function levelBadge(item) {
    const l = LEVELS.find((x) => x.value === levelOf(item));
    if (!l.value) return null;
    return el("span", { class: `level-badge lv${l.value}`, text: `${l.label} ${l.desc}` });
  }

  // 全問題。複数の用語に入っている問題は1つにまとめる
  const allItems = () => {
    const seen = new Set();
    return TERMS.flatMap((t) => t.items).filter((i) => !seen.has(i.key) && seen.add(i.key));
  };

  // ---------- タグ ----------
  // ユーザーが付けたタグはブラウザに保存する。terms.js の tags は固定タグとして常に付く

  const userTags = loadJSON(TAGS_KEY, {});

  // 以前のキー「用語名::問題文」で保存されたタグを、問題文だけのキーに移す
  for (const oldKey of Object.keys(userTags)) {
    const sep = oldKey.indexOf("::");
    if (sep < 0) continue;
    const newKey = oldKey.slice(sep + 2);
    userTags[newKey] = [...new Set([...(userTags[newKey] || []), ...userTags[oldKey]])];
    delete userTags[oldKey];
  }

  function tagsOf(item) {
    return [...new Set([...(item.tags || []), ...(userTags[item.key] || [])])];
  }

  function hasTag(item, tag) {
    return tagsOf(item).includes(tag);
  }

  function toggleTag(item, tag) {
    const list = userTags[item.key] || [];
    userTags[item.key] = list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag];
    if (!userTags[item.key].length) delete userTags[item.key];
    saveJSON(TAGS_KEY, userTags);
    addTagName(tag);
  }

  // 自分で作ったタグの一覧。問題が0問になってもタグが消えないように名前を保存しておく
  const customTagNames = loadJSON(TAG_NAMES_KEY, []);

  function addTagName(tag) {
    if (BUILTIN_TAGS.includes(tag) || customTagNames.includes(tag)) return;
    customTagNames.push(tag);
    saveJSON(TAG_NAMES_KEY, customTagNames);
  }

  // terms.js で問題に書いたタグ（画面からは外せない）
  const isFixedTag = (tag) => allItems().some((i) => (i.tags || []).includes(tag));
  const isEditableTag = (tag) => !BUILTIN_TAGS.includes(tag) && !isFixedTag(tag);

  function renameTag(from, to) {
    for (const key of Object.keys(userTags)) {
      if (userTags[key].includes(from)) {
        userTags[key] = [...new Set(userTags[key].map((t) => (t === from ? to : t)))];
      }
    }
    const i = customTagNames.indexOf(from);
    if (i >= 0) customTagNames.splice(i, 1);
    saveJSON(TAGS_KEY, userTags);
    saveJSON(TAG_NAMES_KEY, customTagNames);
    addTagName(to);
  }

  function deleteTag(tag) {
    for (const key of Object.keys(userTags)) {
      userTags[key] = userTags[key].filter((t) => t !== tag);
      if (!userTags[key].length) delete userTags[key];
    }
    const i = customTagNames.indexOf(tag);
    if (i >= 0) customTagNames.splice(i, 1);
    saveJSON(TAGS_KEY, userTags);
    saveJSON(TAG_NAMES_KEY, customTagNames);
  }

  function tagLabel(tag, active = true) {
    return tag === FAVORITE ? `${active ? "★" : "☆"} ${tag}` : `# ${tag}`;
  }

  // 用意したタグ → 自分で作ったタグ → terms.js のタグ の順に並べる
  function allTagNames() {
    const names = new Set([...BUILTIN_TAGS, ...customTagNames]);
    for (const item of allItems()) tagsOf(item).forEach((t) => names.add(t));
    return [...names];
  }

  // 問題に付いているタグの表示と編集。onChange はタグが変わったときに呼ばれる
  function tagEditor(item, onChange) {
    const wrap = el("div", { class: "tag-editor" });

    function render() {
      const fixed = item.tags || [];
      const chips = allTagNames().map((tag) => {
        const active = hasTag(item, tag);
        const locked = fixed.includes(tag);
        return el("button", {
          type: "button",
          class: `tag-chip ${active ? "active" : ""} ${tag === FAVORITE ? "fav" : ""}`,
          disabled: locked,
          title: locked ? "最初から付いているタグ" : active ? "タグを外す" : "タグを付ける",
          text: tagLabel(tag, active),
          onclick: () => { toggleTag(item, tag); render(); onChange?.(); },
        });
      });
      const input = el("input", { type: "text", class: "tag-input", placeholder: "＋ 新しいタグ", maxlength: 20 });
      input.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" || e.isComposing) return;
        const tag = input.value.trim();
        if (tag && !hasTag(item, tag)) {
          toggleTag(item, tag);
          render();
          onChange?.();
          wrap.querySelector(".tag-input").focus();
        }
      });
      wrap.replaceChildren(...chips, input);
    }

    render();
    return wrap;
  }

  // ---------- 解説 ----------

  // 正解の解説と、選択肢ごとの正誤の理由。order は表示順（order[i] = 元の選択肢番号）
  function explanationBlock(q, order = q.choices.map((_, i) => i)) {
    const reasons = Array.isArray(q.choiceExplanations) ? q.choiceExplanations : [];
    if (!q.explanation && !reasons.some(Boolean)) return null;
    return el("div", { class: "explain" }, [
      el("p", { class: "explain-title", text: "解説" }),
      q.explanation ? el("p", { text: q.explanation }) : null,
      reasons.some(Boolean)
        ? el("ul", { class: "choice-reasons" }, order.map((orig, i) => {
            const ok = orig === q.answer;
            return el("li", { class: ok ? "ok" : "ng" }, [
              el("span", { class: "reason-head" }, [
                el("span", { class: "reason-mark", text: ok ? "○" : "×" }),
                `${MARKS[i]}　${q.choices[orig]}`,
              ]),
              reasons[orig] ? el("span", { class: "reason-text", text: reasons[orig] }) : null,
            ]);
          }))
        : null,
    ]);
  }

  // 用語の解説は閉じた状態で出し、クリックで開く
  function termExplanation(term) {
    if (!term || !term.explanation) return null;
    return el("details", { class: "term-explain" }, [
      el("summary", { text: `用語の解説：${term.name}` }),
      el("p", { text: term.explanation }),
    ]);
  }

  // ---------- 画面遷移 ----------

  // ブラウザの履歴とも連動させ、マウスの戻るボタンや Alt+← でも一つ前の画面に戻れるようにする。
  // ブラウザ側の履歴には「何画面目か」(depth) を持たせておく
  function go(screen, ...args) {
    history.push([screen, args]);
    window.history.pushState({ depth: history.length }, "");
    show();
  }

  function back() {
    if (history.length > 1) window.history.back(); // 実際に戻すのは popstate
  }

  window.history.replaceState({ depth: 1 }, "");
  window.addEventListener("popstate", (e) => {
    const depth = (e.state && e.state.depth) || 1;
    if (depth > history.length) {
      // 「進む」は戻した画面を復元できないので取り消す
      window.history.go(history.length - depth);
      return;
    }
    if (depth === history.length) return;
    history.splice(Math.max(depth, 1));
    show();
  });

  function replace(screen, ...args) {
    history.splice(-1, 1, [screen, args]);
    show();
  }

  function show() {
    stopTimer();
    const [screen, args] = history[history.length - 1];
    backBtn.hidden = history.length <= 1;
    app.replaceChildren(screen(...args));
    window.scrollTo(0, 0);
  }

  backBtn.addEventListener("click", back);

  function listItem(label, sub, onclick, { desc, disabled } = {}) {
    return el("button", { class: "list-item", type: "button", disabled, onclick }, [
      el("span", {}, [label, desc ? el("span", { class: "desc", text: desc }) : null]),
      el("span", { class: "sub", text: sub }),
    ]);
  }

  function termItem(term, showPath) {
    const n = term.items.length;
    return listItem(term.name, `${n}問`, () => go(settingsScreen, { title: term.name, items: term.items, term }), {
      desc: [showPath ? `${term.genre} ／ ${term.category}` : null, term.description].filter(Boolean).join("　"),
      disabled: n === 0,
    });
  }

  // ---------- ホーム（検索・ジャンル・タグ） ----------

  function homeScreen() {
    const results = el("div");

    function renderResults() {
      const q = searchQuery.trim().toLowerCase();
      if (!q) {
        setChildren(results, genreSection(), tagSection());
        return;
      }
      const hits = TERMS.filter((t) =>
        [t.name, t.description, t.genre, t.category].some((s) => s && s.toLowerCase().includes(q))
      );
      results.replaceChildren(
        el("h2", { text: "検索結果" }),
        el("p", { class: "lead", text: `「${searchQuery.trim()}」に一致する用語：${hits.length}件` }),
        hits.length
          ? el("div", { class: "list" }, hits.map((t) => termItem(t, true)))
          : el("div", { class: "empty", text: "見つかりませんでした。" })
      );
    }

    const search = el("input", {
      type: "search", class: "search", placeholder: "用語を検索", value: searchQuery, "aria-label": "用語を検索",
    });
    search.addEventListener("input", () => { searchQuery = search.value; renderResults(); });

    renderResults();
    return el("section", {}, [search, results]);
  }

  function genreSection() {
    return el("div", {}, [
      el("h2", { text: "ジャンルを選ぶ" }),
      el("p", { class: "lead", text: "用語のジャンルを選んでください。" }),
      GENRES.length
        ? el("div", { class: "list" }, GENRES.map((g) => {
            const count = g.categories.reduce((n, c) => n + c.terms.length, 0);
            return listItem(g.name, `${g.categories.length}カテゴリ・${count}語`, () => go(categoryScreen, g));
          }))
        : el("div", { class: "empty", text: "用語がまだありません。data/terms.js に追加してください。" }),
    ]);
  }

  function tagSection() {
    const items = allItems();
    if (!items.length) return null;

    const newTag = el("input", { type: "text", class: "text-input", placeholder: "新しいタグの名前", maxlength: 20 });
    function create() {
      const tag = newTag.value.trim();
      if (!tag) return;
      addTagName(tag);
      go(tagScreen, tag);
    }
    newTag.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) create(); });

    return el("div", { class: "section-gap" }, [
      el("h2", { text: "タグ" }),
      el("p", { class: "lead", text: "タグを選ぶと、入っている問題の確認・追加・削除や、まとめて解くことができます。" }),
      el("div", { class: "list" }, allTagNames().map((tag) => {
        const n = items.filter((i) => hasTag(i, tag)).length;
        return listItem(tagLabel(tag), `${n}問`, () => go(tagScreen, tag));
      })),
      el("div", { class: "inline new-tag" }, [
        newTag,
        el("button", { class: "small-btn", type: "button", text: "タグを作る", onclick: create }),
      ]),
    ]);
  }

  // ---------- タグの管理 ----------

  function tagScreen(tag) {
    const root = el("section");
    let addQuery = "";
    let addOpen = false;

    function questionRow(item, action) {
      return el("div", { class: "manage-item" }, [
        el("div", { class: "manage-body" }, [
          el("div", { class: "manage-meta" }, [levelBadge(item), el("span", { text: item.term.name })]),
          el("p", { class: "manage-q", text: item.question }),
        ]),
        action,
      ]);
    }

    function render() {
      const items = allItems();
      const inTag = items.filter((i) => hasTag(i, tag));
      const others = items.filter((i) => !hasTag(i, tag));
      const q = addQuery.trim().toLowerCase();
      const addable = q
        ? others.filter((i) => [i.question, i.term.name].some((s) => s.toLowerCase().includes(q)))
        : others;

      // 名前の変更・削除は自分で作ったタグだけ
      let editArea = null;
      if (isEditableTag(tag)) {
        const nameInput = el("input", { type: "text", class: "text-input", value: tag, maxlength: 20 });
        editArea = el("div", { class: "card tag-settings" }, [
          el("span", { class: "field-label", text: "タグの名前" }),
          el("div", { class: "inline" }, [
            nameInput,
            el("button", {
              class: "small-btn", type: "button", text: "変更",
              onclick: () => {
                const to = nameInput.value.trim();
                if (!to || to === tag) return;
                if (allTagNames().includes(to) && !confirm(`「${to}」はすでにあります。まとめますか？`)) return;
                renameTag(tag, to);
                replace(tagScreen, to);
              },
            }),
            el("button", {
              class: "small-btn danger", type: "button", text: "タグを削除",
              onclick: () => {
                if (!confirm(`タグ「${tag}」を削除しますか？（問題は消えません）`)) return;
                deleteTag(tag);
                back();
              },
            }),
          ]),
        ]);
      }

      const addSearch = el("input", { type: "search", class: "text-input", placeholder: "問題文・用語名で絞り込み", value: addQuery });
      addSearch.addEventListener("input", () => {
        addQuery = addSearch.value;
        render();
        const s = root.querySelector(".add-search");
        s.focus();
        s.setSelectionRange(s.value.length, s.value.length);
      });
      addSearch.classList.add("add-search");

      const addArea = el("details", { class: "add-area", open: addOpen }, [
        el("summary", { text: `問題を追加する（${others.length}問から）` }),
        addSearch,
        addable.length
          ? el("div", { class: "manage-list" }, addable.map((item) =>
              questionRow(item, el("button", {
                class: "small-btn", type: "button", text: "追加",
                onclick: () => { toggleTag(item, tag); render(); },
              }))
            ))
          : el("div", { class: "empty", text: others.length ? "一致する問題がありません。" : "追加できる問題はありません。" }),
      ]);
      addArea.addEventListener("toggle", () => { addOpen = addArea.open; });

      setChildren(
        root,
        el("h2", { text: tagLabel(tag) }),
        el("p", { class: "lead", text: `${inTag.length}問` }),
        el("div", { class: "actions tag-actions" }, [
          el("button", {
            class: "primary-btn", type: "button", text: "このタグの問題を解く", disabled: inTag.length === 0,
            onclick: () => go(settingsScreen, { title: tagLabel(tag), items: inTag, mixed: true }),
          }),
        ]),
        editArea,
        el("h2", { text: "入っている問題", class: "section-gap" }),
        inTag.length
          ? el("div", { class: "manage-list" }, inTag.map((item) => {
              const fixed = (item.tags || []).includes(tag);
              return questionRow(item, el("button", {
                class: "small-btn", type: "button", text: fixed ? "固定" : "外す", disabled: fixed,
                title: fixed ? "terms.js で付けたタグなので外せません" : "このタグから外す",
                onclick: () => { toggleTag(item, tag); render(); },
              }));
            }))
          : el("div", { class: "empty", text: "まだ問題が入っていません。下の「問題を追加する」から追加できます。" }),
        addArea
      );
    }

    render();
    return root;
  }

  // ---------- カテゴリ・用語選択 ----------

  function categoryScreen(genre) {
    return el("section", {}, [
      el("h2", { text: genre.name }),
      el("p", { class: "lead", text: "カテゴリを選んでください。" }),
      el("div", { class: "list" }, genre.categories.map((c) =>
        listItem(c.name, `${c.terms.length}語`, () => go(termScreen, genre, c))
      )),
    ]);
  }

  function termScreen(genre, category) {
    return el("section", {}, [
      el("h2", { text: category.name }),
      el("p", { class: "lead", text: `${genre.name} ／ 用語を選んでください。` }),
      category.terms.length
        ? el("div", { class: "list" }, category.terms.map((t) => termItem(t, false)))
        : el("div", { class: "empty", text: "このカテゴリにはまだ用語がありません。" }),
    ]);
  }

  // ---------- 設定 ----------
  // source = { title, items, mixed }。mixed は複数の用語の問題が混ざっているとき

  function settingsScreen(source) {
    const settings = { ...DEFAULT_SETTINGS, ...loadJSON(SETTINGS_KEY, {}) };
    let tagFilter = null; // null = すべて
    // 難易度は複数選べる。前回選んだ難易度を引き継ぐ
    const levels = new Set(settings.levels || LEVELS.map((l) => l.value));
    const filtered = () =>
      source.items.filter((i) => (!tagFilter || hasTag(i, tagFilter)) && levels.has(levelOf(i)));

    function segmented(options, current, onSelect) {
      const wrap = el("div", { class: "segmented" });
      for (const [value, label] of options) {
        const btn = el("button", { type: "button", class: value === current ? "active" : "", text: label });
        btn.addEventListener("click", () => {
          wrap.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          onSelect(value);
        });
        wrap.append(btn);
      }
      return wrap;
    }

    const lead = el("p", { class: "lead" });

    // タグで絞り込み（用語から来たときだけ。タグから来たときは絞り込み済み）
    const usedTags = source.mixed ? [] : allTagNames().filter((t) => source.items.some((i) => hasTag(i, t)));
    const tagField = usedTags.length
      ? el("div", { class: "field" }, [
          el("span", { class: "field-label", text: "出題する問題" }),
          segmented(
            [[null, "すべて"], ...usedTags.map((t) => [t, tagLabel(t)])],
            null,
            (v) => { tagFilter = v; updateCount(); }
          ),
        ])
      : null;

    // 難易度（複数選択）。問題がない難易度は押せない
    const levelWrap = el("div", { class: "segmented" });
    for (const l of LEVELS) {
      const n = source.items.filter((i) => levelOf(i) === l.value).length;
      if (l.value === 0 && n === 0) continue; // 未設定の問題がなければ出さない
      const btn = el("button", {
        type: "button",
        class: levels.has(l.value) && n ? "active" : "",
        disabled: n === 0,
        title: l.desc,
        text: `${l.label}（${n}）`,
        onclick: () => {
          if (levels.has(l.value)) levels.delete(l.value);
          else levels.add(l.value);
          btn.classList.toggle("active", levels.has(l.value));
          updateCount();
        },
      });
      levelWrap.append(btn);
    }
    const levelField = el("div", { class: "field" }, [
      el("span", { class: "field-label", text: "難易度（複数選べます）" }),
      levelWrap,
      el("p", { class: "field-hint", text: LEVELS.filter((l) => l.value).map((l) => `${l.label}：${l.desc}`).join("　") }),
    ]);

    // 回答時間
    const customTime = el("input", {
      type: "number", min: 1, max: 600,
      value: TIME_OPTIONS.includes(settings.timeLimit) ? "" : settings.timeLimit,
      placeholder: "任意",
    });
    const timeSeg = segmented(
      TIME_OPTIONS.map((s) => [s, s === 0 ? "制限なし" : `${s}秒`]),
      settings.timeLimit,
      (v) => { settings.timeLimit = v; customTime.value = ""; }
    );
    customTime.addEventListener("input", () => {
      const v = parseInt(customTime.value, 10);
      if (v > 0) {
        settings.timeLimit = v;
        timeSeg.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      }
    });

    // 問題数
    const countInput = el("input", { type: "number", min: 1 });
    const countTotal = el("span");
    const allCheck = el("input", { type: "checkbox", checked: settings.count === 0 });
    allCheck.addEventListener("change", () => { countInput.disabled = allCheck.checked; });

    function updateCount() {
      const n = filtered().length;
      lead.textContent = `全${n}問 ／ 出題の設定をしてください。`;
      countInput.max = n;
      countInput.value = Math.min(settings.count || n, n);
      countInput.disabled = allCheck.checked;
      countTotal.textContent = `問 ／ ${n}問`;
      startBtn.disabled = n === 0;
    }

    // 出題順
    const orderSeg = segmented(
      [["sequential", "登録順"], ["random", "ランダム"]],
      settings.order,
      (v) => { settings.order = v; }
    );

    function start() {
      const items = filtered();
      settings.count = allCheck.checked
        ? 0
        : Math.min(items.length, Math.max(1, parseInt(countInput.value, 10) || items.length));
      settings.levels = [...levels];
      saveJSON(SETTINGS_KEY, settings);
      go(quizScreen, source, pickQuestions(items, settings), settings);
    }

    const startBtn = el("button", { class: "primary-btn", type: "button", text: "スタート", onclick: start });
    updateCount();

    return el("section", {}, [
      el("h2", { text: source.title }),
      lead,
      termExplanation(source.term),
      el("div", { class: "card" }, [
        tagField,
        levelField,
        el("div", { class: "field" }, [
          el("span", { class: "field-label", text: "回答時間（1問あたり）" }),
          timeSeg,
          el("div", { class: "inline", style: "margin-top:8px" }, [customTime, "秒（自由に入力）"]),
        ]),
        el("div", { class: "field" }, [
          el("span", { class: "field-label", text: "問題数" }),
          el("div", { class: "inline" }, [el("label", { class: "check" }, [allCheck, "全問"]), countInput, countTotal]),
        ]),
        el("div", { class: "field" }, [
          el("span", { class: "field-label", text: "出題順" }),
          orderSeg,
          el("p", { class: "field-hint", text: "選択肢の並びは毎回ランダムです。" }),
        ]),
      ]),
      el("div", { class: "actions" }, [startBtn]),
    ]);
  }

  function pickQuestions(items, settings) {
    const list = settings.order === "random" ? shuffle(items) : items.slice();
    return settings.count ? list.slice(0, settings.count) : list;
  }

  // ---------- クイズ ----------

  function quizScreen(source, questions, settings) {
    const results = [];
    let index = 0;
    const root = el("section");

    function render() {
      stopTimer();
      const q = questions[index];
      // 選択肢は毎回ランダムに並べる。order[i] = 元の選択肢番号
      const order = shuffle(q.choices.map((_, i) => i));
      let answered = false;

      const timerBar = el("div", { class: "timer-bar" });
      const timeLabel = el("span");
      const feedbackArea = el("div");
      const choiceBtns = order.map((orig, i) =>
        el("button", { class: "choice", type: "button", onclick: () => answer(orig) }, [
          el("span", { class: "mark", text: MARKS[i] }),
          el("span", { text: q.choices[orig] }),
        ])
      );

      function answer(selected) {
        if (answered) return;
        answered = true;
        stopTimer();
        const correct = selected === q.answer;
        results.push({ question: q, selected, correct, order });

        choiceBtns.forEach((btn, i) => {
          btn.disabled = true;
          if (order[i] === q.answer) btn.classList.add("correct");
          else if (order[i] === selected) btn.classList.add("wrong");
        });

        const title = correct ? "正解！" : selected === null ? "時間切れ" : "不正解";
        const isLast = index === questions.length - 1;
        setChildren(
          feedbackArea,
          el("div", { class: `feedback ${correct ? "correct" : "wrong"}` }, [
            el("p", { class: "feedback-title", text: title }),
            correct ? null : el("p", { text: `正解：${q.choices[q.answer]}` }),
          ]),
          explanationBlock(q, order),
          termExplanation(q.term),
          el("div", { class: "actions" }, [
            el("button", {
              class: "primary-btn", type: "button",
              text: isLast ? "結果を見る" : "次の問題へ",
              onclick: () => {
                if (isLast) {
                  // 戻るで結果からクイズに戻らないよう、履歴を差し替える
                  replace(resultScreen, source, results, settings);
                } else {
                  index++;
                  render();
                }
              },
            }),
          ])
        );
        feedbackArea.querySelector(".primary-btn").focus();
      }

      setChildren(
        root,
        el("div", { class: "quiz-top" }, [
          el("span", { text: `${source.mixed ? q.term.name : source.title}　${index + 1} / ${questions.length}` }),
          timeLabel,
        ]),
        levelBadge(q),
        settings.timeLimit ? el("div", { class: "timer" }, [timerBar]) : null,
        el("p", { class: "question-text", text: q.question }),
        el("div", { class: "choices" }, choiceBtns),
        tagEditor(q),
        feedbackArea
      );

      if (settings.timeLimit) {
        const limitMs = settings.timeLimit * 1000;
        const startAt = performance.now();
        const tick = (now) => {
          const remain = Math.max(0, limitMs - (now - startAt));
          timerBar.style.width = `${(remain / limitMs) * 100}%`;
          timerBar.classList.toggle("low", remain <= Math.min(5000, limitMs * 0.3));
          timeLabel.textContent = `残り ${Math.ceil(remain / 1000)}秒`;
          if (remain <= 0) answer(null);
          else timerId = requestAnimationFrame(tick);
        };
        timerId = requestAnimationFrame(tick);
      }
    }

    render();
    return root;
  }

  // 数字キー 1〜4 / A〜D で回答（ア〜エの順。3択ならア〜ウ）、Enter で次へ
  document.addEventListener("keydown", (e) => {
    // Esc で一つ前の画面に戻る（入力欄では入力のじゃまをしない）
    if (e.key === "Escape" && e.target.tagName !== "INPUT" && !backBtn.hidden) {
      back();
      return;
    }
    if (e.target.tagName === "INPUT" || e.key.length !== 1) return;
    const key = e.key.toUpperCase();
    const i = "1234".includes(key) ? "1234".indexOf(key) : "ABCD".indexOf(key);
    const choices = app.querySelectorAll(".choice");
    if (i >= 0 && choices[i] && !choices[i].disabled) choices[i].click();
  });

  // ---------- 結果 ----------

  function resultScreen(source, results, settings) {
    const correctCount = results.filter((r) => r.correct).length;
    const wrongQuestions = results.filter((r) => !r.correct).map((r) => r.question);
    const rate = Math.round((correctCount / results.length) * 100);

    const review = results.map((r) => {
      const q = r.question;
      return el("div", { class: `review-item ${r.correct ? "" : "wrong"}` }, [
        levelBadge(q),
        el("p", { class: "q", text: `${r.correct ? "○" : "×"} ${q.question}` }),
        el("p", {
          class: "a",
          text: r.correct
            ? `正解：${q.choices[q.answer]}`
            : `あなたの回答：${r.selected === null ? "時間切れ" : q.choices[r.selected]} ／ 正解：${q.choices[q.answer]}`,
        }),
        explanationBlock(q)
          ? el("details", { class: "review-explain" }, [el("summary", { text: "解説を見る" }), explanationBlock(q, r.order)])
          : null,
        tagEditor(q),
      ]);
    });

    return el("section", {}, [
      el("h2", { text: `${source.title} の結果` }),
      el("div", { class: "card score" }, [
        el("div", { class: "score-num", text: `${correctCount} / ${results.length}` }),
        el("div", { class: "score-rate", text: `正答率 ${rate}%` }),
      ]),
      el("div", { class: "actions" }, [
        wrongQuestions.length
          ? el("button", {
              class: "primary-btn", type: "button", text: `間違えた${wrongQuestions.length}問をもう一度`,
              onclick: () => replace(quizScreen, source, wrongQuestions, settings),
            })
          : null,
        el("button", {
          class: wrongQuestions.length ? "secondary-btn" : "primary-btn", type: "button", text: "同じ問題をもう一度",
          onclick: () => replace(quizScreen, source, pickQuestions(results.map((r) => r.question), { ...settings, count: 0 }), settings),
        }),
        el("button", { class: "secondary-btn", type: "button", text: "設定を変える", onclick: back }),
      ]),
      el("h2", { text: "振り返り", class: "section-gap" }),
      el("p", { class: "lead", text: "★やタグを付けると、ホームの「タグから解く」でまとめて解けます。" }),
      el("div", { class: "review" }, review),
    ]);
  }

  history.push([homeScreen, []]); // 最初の画面はブラウザの履歴に積まない
  show();
})();
