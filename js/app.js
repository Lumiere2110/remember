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
  // mode: "exam" = 最後にまとめて採点（本番形式） / "instant" = 1問ずつ答え合わせ
  const DEFAULT_SETTINGS = { timeLimit: 0, count: 0, order: "sequential", mode: "exam" };

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

  // ブラウザの履歴とも連動させ、マウスのボタン4・5（戻る・進む）や Alt+←・Alt+→ でも画面を移動できるようにする。
  // ブラウザ側の履歴には「何画面目か」(depth) を持たせておく。
  // 戻った画面は forwardScreens に取っておき、「進む」で復元する
  let forwardScreens = [];

  function go(screen, ...args) {
    history.push([screen, args]);
    forwardScreens = []; // 新しい画面に進んだら、それより先の「進む」先は消える
    window.history.pushState({ depth: history.length }, "");
    show();
  }

  function back() {
    if (history.length > 1) window.history.back(); // 実際に戻すのは popstate
  }

  window.history.replaceState({ depth: 1 }, "");
  window.addEventListener("popstate", (e) => {
    const depth = (e.state && e.state.depth) || 1;
    if (depth === history.length) return;
    if (depth < history.length) {
      forwardScreens = history.splice(Math.max(depth, 1)).concat(forwardScreens);
    } else {
      const need = depth - history.length;
      if (forwardScreens.length < need) {
        // 復元できる画面がない（再読み込みした後など）ときは、進んだのを取り消す
        window.history.go(history.length - depth);
        return;
      }
      history.push(...forwardScreens.splice(0, need));
    }
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
    document.body.classList.toggle("on-title", screen === titleScreen); // タイトル画面ではヘッダーを隠す
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

    // 採点のしかた
    const modeSeg = segmented(
      [["exam", "最後にまとめて採点（本番形式）"], ["instant", "1問ずつ答え合わせ"]],
      settings.mode,
      (v) => { settings.mode = v; }
    );

    return el("section", {}, [
      el("h2", { text: source.title }),
      lead,
      termExplanation(source.term),
      el("div", { class: "card" }, [
        el("div", { class: "field" }, [
          el("span", { class: "field-label", text: "採点のしかた" }),
          modeSeg,
          el("p", {
            class: "field-hint",
            text: "本番形式：CBT試験のように全問に答えてから「試験終了」で採点。前の問題に戻って答えを変えたり、「後で見直す」を付けたりできます。",
          }),
        ]),
        tagField,
        levelField,
        el("div", { class: "field" }, [
          el("span", { class: "field-label", text: "回答時間（1問あたり）" }),
          timeSeg,
          el("div", { class: "inline", style: "margin-top:8px" }, [customTime, "秒（自由に入力）"]),
          el("p", { class: "field-hint", text: "本番形式では「1問あたりの時間 × 問題数」が全体の制限時間になります。" }),
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

  // ---------- クイズ（CBT方式の画面） ----------
  // settings.mode が "instant" なら1問ずつ答え合わせ、それ以外は最後にまとめて採点（本番形式）

  function quizScreen(source, questions, settings) {
    return settings.mode === "instant"
      ? instantQuiz(source, questions, settings)
      : examQuiz(source, questions, settings);
  }

  function formatTime(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  // CBT の画面の枠。上：問題番号・残り時間、中：問題（本番形式では問題一覧も）、下：移動ボタン
  function cbtFrame({ head, body, side, foot, showSide }) {
    return el("div", { class: "cbt" }, [
      el("div", { class: "cbt-head" }, head),
      el("div", { class: `cbt-main${side ? " has-side" : ""}${showSide ? " show-side" : ""}` }, [
        el("div", { class: "cbt-body" }, body),
        side ? el("aside", { class: "cbt-side" }, side) : null,
      ]),
      el("div", { class: "cbt-foot" }, foot),
    ]);
  }

  // 選択肢。○ ア 選択肢の文 の形で表示する
  function choiceButton(i, text, onclick) {
    return el("button", { class: "choice", type: "button", onclick }, [
      el("span", { class: "radio" }),
      el("span", { class: "mark", text: MARKS[i] }),
      el("span", { class: "choice-text", text }),
    ]);
  }

  function navButton(text, onclick, { key, primary, disabled, extraClass } = {}) {
    return el("button", {
      class: `nav-btn${primary ? " primary" : ""}${extraClass ? ` ${extraClass}` : ""}`,
      type: "button", text, onclick, disabled, "data-key": key,
    });
  }

  // 本番形式：全問に答えてから「試験終了」で採点する
  function examQuiz(source, questions, settings) {
    // 選択肢の並びは問題ごとに最初に1回だけ決める（前後に移動しても変わらない）
    const states = questions.map((q) => ({ order: shuffle(q.choices.map((_, i) => i)), selected: null, flag: false }));
    let index = 0;
    let showList = false; // 狭い画面で問題一覧を開いているか
    let finished = false;
    const root = el("section", { class: "cbt-screen" });
    const timeLabel = el("span", { class: "cbt-time" });

    function finish() {
      if (finished) return;
      finished = true;
      stopTimer();
      playSound("finish");
      const results = questions.map((q, i) => ({
        question: q,
        selected: states[i].selected,
        correct: states[i].selected === q.answer,
        order: states[i].order,
      }));
      // 戻るで結果から試験に戻らないよう、履歴を差し替える
      replace(resultScreen, source, results, settings);
    }

    function confirmFinish() {
      const unanswered = states.filter((s) => s.selected === null).length;
      const flagged = states.filter((s) => s.flag).length;
      const close = () => overlay.remove();
      const overlay = el("div", { class: "modal-backdrop", onclick: (e) => { if (e.target === overlay) close(); } }, [
        el("div", { class: "modal", role: "dialog", "aria-modal": "true" }, [
          el("p", { class: "modal-title", text: "試験を終了して採点しますか？" }),
          unanswered ? el("p", { class: "modal-warn", text: `未回答の問題が ${unanswered}問 あります。` }) : null,
          flagged ? el("p", { class: "modal-warn", text: `「後で見直す」が付いた問題が ${flagged}問 あります。` }) : null,
          !unanswered && !flagged ? el("p", { text: "すべての問題に回答しています。" }) : null,
          el("div", { class: "modal-actions" }, [
            navButton("問題に戻る", close, { extraClass: "modal-cancel" }),
            navButton("終了して採点する", finish, { primary: true }),
          ]),
        ]),
      ]);
      root.append(overlay);
      overlay.querySelector(".modal-cancel").focus();
    }

    function moveTo(i) {
      index = i;
      showList = false;
      render();
    }

    function questionList() {
      const answered = states.filter((s) => s.selected !== null).length;
      return [
        el("p", { class: "q-list-title", text: `問題一覧（回答済み ${answered} / ${questions.length}）` }),
        el("div", { class: "q-grid" }, states.map((s, i) =>
          el("button", {
            type: "button",
            class: ["q-cell", s.selected !== null && "answered", s.flag && "flagged", i === index && "current"].filter(Boolean).join(" "),
            title: `問${i + 1}：${s.selected !== null ? "回答済み" : "未回答"}${s.flag ? "・後で見直す" : ""}`,
            text: String(i + 1),
            onclick: () => moveTo(i),
          })
        )),
        el("div", { class: "q-legend" }, [
          el("span", {}, [el("span", { class: "q-cell mini answered" }), "回答済み"]),
          el("span", {}, [el("span", { class: "q-cell mini" }), "未回答"]),
          el("span", {}, [el("span", { class: "q-cell mini flagged" }), "後で見直す"]),
        ]),
      ];
    }

    function render() {
      const q = questions[index];
      const s = states[index];
      const isFirst = index === 0;
      const isLast = index === questions.length - 1;

      const choiceBtns = s.order.map((orig, i) => {
        const btn = choiceButton(i, q.choices[orig], () => { s.selected = orig; render(); });
        if (s.selected === orig) btn.classList.add("selected");
        return btn;
      });
      const flag = el("input", { type: "checkbox", checked: s.flag });
      flag.addEventListener("change", () => { s.flag = flag.checked; render(); });

      setChildren(root, cbtFrame({
        head: [
          el("span", { class: "cbt-num", text: `問${index + 1}` }),
          el("span", { class: "cbt-count", text: `/ ${questions.length}問` }),
          el("span", { class: "cbt-term", text: source.hideTerm ? source.title : source.mixed ? q.term.name : source.title }),
          el("label", { class: "cbt-flag" }, [flag, "後で見直す"]),
          timeLabel,
        ],
        body: [
          levelBadge(q),
          el("p", { class: "question-text", text: q.question }),
          el("div", { class: "choices" }, choiceBtns),
          tagEditor(q),
        ],
        side: questionList(),
        showSide: showList,
        foot: [
          navButton("◀ 前の問題", () => moveTo(index - 1), { key: "prev", disabled: isFirst }),
          navButton(showList ? "問題一覧を閉じる" : "問題一覧", () => { showList = !showList; render(); }, { extraClass: "list-toggle" }),
          navButton("次の問題 ▶", () => moveTo(index + 1), { key: "next", disabled: isLast, primary: !isLast }),
          el("span", { class: "spacer" }),
          navButton("試験終了", confirmFinish, { primary: isLast, extraClass: "finish" }),
        ],
      }));
    }

    // 時間。制限ありなら「1問あたりの時間 × 問題数」（テストでは試験ごとの時間）から減らしていき、
    // 0 になったら採点する。制限なしなら経過時間
    const limitMs = settings.totalMs || (settings.timeLimit || 0) * 1000 * questions.length;
    const startAt = performance.now();
    let warned = false;
    playSound("start");
    const tick = (now) => {
      const elapsed = now - startAt;
      if (limitMs) {
        const remain = limitMs - elapsed;
        timeLabel.textContent = `残り ${formatTime(remain)}`;
        const low = remain <= Math.min(5 * 60000, limitMs * 0.1);
        timeLabel.classList.toggle("low", low);
        if (low && !warned) { warned = true; playSound("warn"); }
        if (remain <= 0) { finish(); return; }
      } else {
        timeLabel.textContent = `経過 ${formatTime(elapsed)}`;
      }
      timerId = requestAnimationFrame(tick);
    };
    timerId = requestAnimationFrame(tick);

    render();
    return root;
  }

  // 1問ずつ答え合わせ：選ぶとすぐに正解・解説を表示する
  function instantQuiz(source, questions, settings) {
    const results = [];
    let index = 0;
    const root = el("section", { class: "cbt-screen" });

    function render() {
      stopTimer();
      const q = questions[index];
      // 選択肢は毎回ランダムに並べる。order[i] = 元の選択肢番号
      const order = shuffle(q.choices.map((_, i) => i));
      const isLast = index === questions.length - 1;
      let answered = false;

      const timerBar = el("div", { class: "timer-bar" });
      const timeLabel = el("span", { class: "cbt-time" });
      const feedbackArea = el("div");
      const nextBtn = navButton(isLast ? "結果を見る ▶" : "次の問題 ▶", () => {
        if (isLast) replace(resultScreen, source, results, settings); // 戻るで結果からクイズに戻らないよう、履歴を差し替える
        else { index++; render(); }
      }, { key: "next", primary: true, disabled: true });
      const choiceBtns = order.map((orig, i) => choiceButton(i, q.choices[orig], () => answer(orig)));

      function answer(selected) {
        if (answered) return;
        answered = true;
        stopTimer();
        const correct = selected === q.answer;
        results.push({ question: q, selected, correct, order });
        playSound(correct ? "correct" : "wrong");

        choiceBtns.forEach((btn, i) => {
          btn.disabled = true;
          if (order[i] === selected) btn.classList.add("selected");
          if (order[i] === q.answer) btn.classList.add("correct");
          else if (order[i] === selected) btn.classList.add("wrong");
        });

        const title = correct ? "正解！" : selected === null ? "時間切れ" : "不正解";
        setChildren(
          feedbackArea,
          el("div", { class: `feedback ${correct ? "correct" : "wrong"}` }, [
            el("p", { class: "feedback-title", text: title }),
            correct ? null : el("p", { text: `正解：${q.choices[q.answer]}` }),
          ]),
          explanationBlock(q, order),
          termExplanation(q.term)
        );
        nextBtn.disabled = false;
        nextBtn.focus();
      }

      setChildren(root, cbtFrame({
        head: [
          el("span", { class: "cbt-num", text: `問${index + 1}` }),
          el("span", { class: "cbt-count", text: `/ ${questions.length}問` }),
          el("span", { class: "cbt-term", text: source.mixed ? q.term.name : source.title }),
          timeLabel,
        ],
        body: [
          settings.timeLimit ? el("div", { class: "timer" }, [timerBar]) : null,
          levelBadge(q),
          el("p", { class: "question-text", text: q.question }),
          el("div", { class: "choices" }, choiceBtns),
          tagEditor(q),
          feedbackArea,
        ],
        foot: [el("span", { class: "spacer" }), nextBtn],
      }));

      if (settings.timeLimit) {
        const limitMs = settings.timeLimit * 1000;
        const startAt = performance.now();
        const tick = (now) => {
          const remain = Math.max(0, limitMs - (now - startAt));
          timerBar.style.width = `${(remain / limitMs) * 100}%`;
          timerBar.classList.toggle("low", remain <= Math.min(5000, limitMs * 0.3));
          timeLabel.textContent = `残り ${Math.ceil(remain / 1000)}秒`;
          timeLabel.classList.toggle("low", remain <= Math.min(5000, limitMs * 0.3));
          if (remain <= 0) answer(null);
          else timerId = requestAnimationFrame(tick);
        };
        timerId = requestAnimationFrame(tick);
      }
    }

    render();
    return root;
  }

  // 数字キー 1〜4 / A〜D で回答（ア〜エの順。3択ならア〜ウ）、← → で前後の問題、Enter で次へ
  document.addEventListener("keydown", (e) => {
    const modal = app.querySelector(".modal-backdrop");
    if (modal) {
      if (e.key === "Escape") modal.remove(); // 確認画面を閉じる
      return;
    }
    const typing = ["INPUT", "TEXTAREA"].includes(e.target.tagName);
    // Esc で一つ前の画面に戻る（入力欄では入力のじゃまをしない）
    if (e.key === "Escape" && !typing && !backBtn.hidden) {
      back();
      return;
    }
    if (typing) return;
    // Space で単語カードを裏返す
    if (e.key === " ") {
      const card = app.querySelector('[data-key="flip"]');
      if (card) { e.preventDefault(); card.click(); }
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const btn = app.querySelector(`[data-key="${e.key === "ArrowLeft" ? "prev" : "next"}"]`);
      if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
      return;
    }
    if (e.key.length !== 1) return;
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
            : `あなたの回答：${r.selected === null ? (settings.mode === "instant" ? "時間切れ" : "未回答") : q.choices[r.selected]} ／ 正解：${q.choices[q.answer]}`,
        }),
        explanationBlock(q)
          ? el("details", { class: "review-explain" }, [el("summary", { text: "解説を見る" }), explanationBlock(q, r.order)])
          : null,
        tagEditor(q),
      ]);
    });

    // テストのときは、間違えた問題を「1問ずつ答え合わせ」で練習できるようにする
    const practiceSettings = settings.exam
      ? { ...DEFAULT_SETTINGS, mode: "instant", timeLimit: 0 }
      : settings;

    return el("section", {}, [
      el("h2", { text: `${source.title} の結果` }),
      settings.exam
        ? examScoreCard(settings.exam, results)
        : el("div", { class: "card score" }, [
            el("div", { class: "score-num", text: `${correctCount} / ${results.length}` }),
            el("div", { class: "score-rate", text: `正答率 ${rate}%` }),
          ]),
      el("div", { class: "actions" }, settings.exam
        ? [
            wrongQuestions.length
              ? el("button", {
                  class: "primary-btn", type: "button", text: `間違えた${wrongQuestions.length}問を練習する（1問ずつ答え合わせ）`,
                  onclick: () => replace(quizScreen, { title: `${source.title}：間違えた問題`, items: wrongQuestions, mixed: true }, wrongQuestions, practiceSettings),
                })
              : null,
            el("button", {
              class: wrongQuestions.length ? "secondary-btn" : "primary-btn", type: "button", text: "もう一度受験する（問題は選び直し）",
              onclick: () => startExam(settings.exam, true),
            }),
            el("button", { class: "secondary-btn", type: "button", text: "試験の説明に戻る", onclick: back }),
          ]
        : [
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
      el("p", { class: "lead", text: "★やタグを付けると、練習の「タグ」からまとめて解けます。" }),
      el("div", { class: "review" }, review),
    ]);
  }

  // ======================================================================
  // サウンド
  // 効果音はファイルを使わず、Web Audio API で音を作って鳴らす
  // ======================================================================

  const SOUND_KEY = "remember.sound";
  const sound = { game: 60, click: 40, ...loadJSON(SOUND_KEY, {}) }; // 0〜100
  let audioCtx = null;

  function audio() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  // freq の音を start 秒後から dur 秒間鳴らす
  function tone(freq, start, dur, volume, type = "sine") {
    if (volume <= 0) return;
    const ctx = audio();
    if (!ctx) return;
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function playSound(name) {
    if (name === "click") {
      tone(1100, 0, 0.05, (sound.click / 100) * 0.2, "triangle");
      return;
    }
    const v = (sound.game / 100) * 0.25;
    switch (name) {
      case "correct": tone(784, 0, 0.12, v); tone(1175, 0.1, 0.3, v); break;
      case "wrong": tone(311, 0, 0.18, v * 0.7, "square"); tone(233, 0.15, 0.35, v * 0.7, "square"); break;
      case "start": tone(523, 0, 0.12, v); tone(659, 0.12, 0.12, v); tone(784, 0.24, 0.3, v); break;
      case "finish": tone(784, 0, 0.15, v); tone(659, 0.15, 0.15, v); tone(1047, 0.3, 0.45, v); break;
      case "warn": tone(988, 0, 0.12, v, "square"); tone(988, 0.2, 0.12, v, "square"); break;
    }
  }

  // ボタンなどを押したときのクリック音
  document.addEventListener("click", (e) => {
    const target = e.target.closest("button, summary, input[type=checkbox], input[type=radio]");
    if (target && !target.disabled && !target.dataset.silent) playSound("click");
  }, true);

  // ======================================================================
  // カラー
  // ======================================================================

  const COLOR_KEY = "remember.color";
  const color = { theme: "auto", accent: "", bg: "", ...loadJSON(COLOR_KEY, {}) };

  function applyColor() {
    const root = document.documentElement;
    if (color.theme === "auto") delete root.dataset.theme;
    else root.dataset.theme = color.theme;
    if (color.accent) {
      root.style.setProperty("--accent", color.accent);
      root.style.setProperty("--accent-soft", `color-mix(in srgb, ${color.accent} 22%, var(--surface))`);
    } else {
      root.style.removeProperty("--accent");
      root.style.removeProperty("--accent-soft");
    }
    if (color.bg) root.style.setProperty("--bg", color.bg);
    else root.style.removeProperty("--bg");
  }
  applyColor();

  // 背景色の明るさ（0〜1）。背景に合わせてライト・ダークを自動で切り替えるのに使う
  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  // ======================================================================
  // タイトル画面
  // ======================================================================

  function titleScreen() {
    const menu = [
      ["練習", "ジャンル・タグを選んで、自分のペースで解く", () => go(homeScreen)],
      ["テスト", "ITパスポート・基本情報・応用情報の試験をCBT方式で受ける", () => go(examSelectScreen)],
      ["単語カード", "自分で単語帳を作って、カードをめくって覚える", () => go(wordbookListScreen)],
      ["設定", "サウンド・カラー・問題一覧", () => go(settingsMenuScreen)],
      ["終了", "ゲームを終了する", quit],
    ];
    return el("section", { class: "title-screen" }, [
      el("h1", { class: "title-logo", text: "remember" }),
      el("p", { class: "title-sub", text: "IT用語を覚えるクイズ" }),
      el("div", { class: "title-menu" }, menu.map(([label, desc, onclick], i) =>
        el("button", { class: `title-btn${i === 0 ? " primary" : ""}`, type: "button", title: desc, onclick }, [
          el("span", { class: "title-btn-label", text: label }),
          el("span", { class: "title-btn-desc", text: desc }),
        ])
      )),
    ]);
  }

  // ブラウザは、ユーザーが自分で開いたタブをページから閉じることを許可していない。
  // 閉じられなかったときは、閉じ方を案内する画面を出す
  function quit() {
    window.close();
    setTimeout(() => { if (!window.closed) go(quitScreen); }, 300);
  }

  function quitScreen() {
    return el("section", { class: "center-screen" }, [
      el("h2", { text: "ゲームを終了します" }),
      el("p", { class: "lead", text: "ブラウザの仕組み上、このページからタブを閉じることができませんでした。" }),
      el("p", { text: "タブの × ボタン、または Ctrl + W（Mac は ⌘ + W）でタブを閉じてください。" }),
      el("div", { class: "actions narrow" }, [
        el("button", { class: "secondary-btn", type: "button", text: "タイトルに戻る", onclick: back }),
      ]),
    ]);
  }

  // ======================================================================
  // テスト（本番と同じ問題数・制限時間で、CBT方式で受験する）
  // ======================================================================

  const EXAMS = [
    {
      id: "ip", name: "ITパスポート試験", level: 1, count: 100, minutes: 120, scoreMax: 1000, pass: 600,
      fieldPass: 300,
      rule: "100問・120分。総合評価点が1000点満点中600点以上、かつ ストラテジ系・マネジメント系・テクノロジ系の分野別評価点がそれぞれ1000点満点中300点以上で合格。",
    },
    {
      id: "fe", name: "基本情報技術者試験（科目A）", level: 2, count: 60, minutes: 90, scoreMax: 1000, pass: 600,
      rule: "科目A：60問・90分。1000点満点中600点以上が合格基準（本番の合格には科目Bも600点以上が必要）。",
    },
    {
      id: "ap", name: "応用情報技術者試験（午前）", level: 3, count: 80, minutes: 150, scoreMax: 100, pass: 60,
      rule: "午前：80問・150分。100点満点中60点以上が合格基準（本番の合格には午後も60点以上が必要）。",
    },
  ];

  // ITパスポートの分野。カテゴリから決める
  const STRATEGY_CATEGORIES = ["企業活動", "経営戦略", "法務", "技術戦略", "システム戦略"];
  const MANAGEMENT_CATEGORIES = ["プロジェクトマネジメント", "サービスマネジメント", "システム監査"];
  const FIELDS = ["ストラテジ系", "マネジメント系", "テクノロジ系"];
  function fieldOf(item) {
    if (STRATEGY_CATEGORIES.includes(item.term.category)) return "ストラテジ系";
    if (MANAGEMENT_CATEGORIES.includes(item.term.category)) return "マネジメント系";
    return "テクノロジ系";
  }

  // その試験に出せる問題（情報・テクノロジーの、その難易度の問題）
  function examPool(exam) {
    return allItems().filter((i) => i.term.genre === "情報・テクノロジー" && levelOf(i) === exam.level);
  }

  // 登録問題が本番の問題数より少ないときは、全問を出題し、時間も問題数に合わせて減らす（1問あたりの時間は本番と同じ）
  function examPlan(exam) {
    const pool = examPool(exam);
    const count = Math.min(pool.length, exam.count);
    const minutes = count === exam.count ? exam.minutes : Math.max(1, Math.ceil((exam.minutes * count) / exam.count));
    return { pool, count, minutes };
  }

  function startExam(exam, replaceCurrent = false) {
    const { pool, count, minutes } = examPlan(exam);
    const questions = shuffle(pool).slice(0, count);
    const source = { title: exam.name, items: questions, mixed: true, hideTerm: true };
    const settings = { ...DEFAULT_SETTINGS, mode: "exam", totalMs: minutes * 60000, exam };
    (replaceCurrent ? replace : go)(quizScreen, source, questions, settings);
  }

  function examSelectScreen() {
    return el("section", {}, [
      el("h2", { text: "テスト" }),
      el("p", { class: "lead", text: "受験する試験を選んでください。本番と同じように CBT方式で、最後にまとめて採点します。" }),
      el("div", { class: "exam-list" }, EXAMS.map((exam) => {
        const { count, minutes } = examPlan(exam);
        const short = count < exam.count;
        return el("div", { class: "card exam-card" }, [
          el("h3", { class: "exam-name", text: exam.name }),
          el("p", { class: "exam-rule", text: exam.rule }),
          el("p", {
            class: `exam-plan${short ? " short" : ""}`,
            text: count === 0
              ? "この難易度の問題がまだ登録されていないため、受験できません。"
              : short
                ? `登録されている問題が${count}問のため、${count}問・${minutes}分で出題します（1問あたりの時間は本番と同じ）。`
                : `${count}問・${minutes}分で出題します。`,
          }),
          el("button", {
            class: "primary-btn", type: "button", text: "受験する", disabled: count === 0,
            onclick: () => go(examIntroScreen, exam),
          }),
        ]);
      })),
    ]);
  }

  // 受験前の説明画面
  function examIntroScreen(exam) {
    const { count, minutes } = examPlan(exam);
    return el("section", {}, [
      el("h2", { text: exam.name }),
      el("div", { class: "card exam-intro" }, [
        el("dl", { class: "exam-facts" }, [
          el("dt", { text: "問題数" }), el("dd", { text: `${count}問${count < exam.count ? `（本番は${exam.count}問）` : ""}` }),
          el("dt", { text: "試験時間" }), el("dd", { text: `${minutes}分${count < exam.count ? `（本番は${exam.minutes}分）` : ""}` }),
          el("dt", { text: "合格基準" }), el("dd", { text: exam.rule }),
        ]),
        el("ul", { class: "exam-notes" }, [
          el("li", { text: "問題はランダムに選ばれ、選択肢の並びも毎回変わります。" }),
          el("li", { text: "「前の問題」「次の問題」や問題一覧で自由に移動し、答えを何度でも変えられます。" }),
          el("li", { text: "迷った問題には「後で見直す」を付けておけます。" }),
          el("li", { text: "「試験終了」を押すか、時間が0になると採点します。" }),
          el("li", { text: "途中で戻ると、それまでの解答は消えます。" }),
          el("li", { text: "点数は正答率から計算した目安です（本番は IRT という方式で採点されます）。" }),
        ]),
      ]),
      el("div", { class: "actions" }, [
        el("button", { class: "primary-btn", type: "button", text: "試験開始", onclick: () => startExam(exam) }),
      ]),
    ]);
  }

  // テストの結果（点数・合否・分野別）
  function examScoreCard(exam, results) {
    const score = (rs) => (rs.length ? Math.round((rs.filter((r) => r.correct).length / rs.length) * exam.scoreMax) : null);
    const total = score(results);
    const fields = exam.fieldPass
      ? FIELDS.map((name) => {
          const rs = results.filter((r) => fieldOf(r.question) === name);
          return { name, count: rs.length, correct: rs.filter((r) => r.correct).length, score: score(rs) };
        })
      : [];
    // 出題がなかった分野は合否の判定に使わない
    const fieldsOk = fields.every((f) => f.score === null || f.score >= exam.fieldPass);
    const passed = total >= exam.pass && fieldsOk;
    const correctCount = results.filter((r) => r.correct).length;

    return el("div", { class: `card exam-score ${passed ? "pass" : "fail"}` }, [
      el("div", { class: "exam-verdict", text: passed ? "合格" : "不合格" }),
      el("div", { class: "score-num", text: `${total}点` }),
      el("div", { class: "score-rate", text: `${exam.scoreMax}点満点（合格基準 ${exam.pass}点）／ ${correctCount} / ${results.length}問 正解` }),
      fields.length
        ? el("table", { class: "field-table" }, [
            el("thead", {}, el("tr", {}, [el("th", { text: "分野" }), el("th", { text: "正解" }), el("th", { text: "評価点" }), el("th", { text: "基準" })])),
            el("tbody", {}, fields.map((f) => el("tr", {}, [
              el("td", { text: f.name }),
              el("td", { text: f.count ? `${f.correct} / ${f.count}` : "出題なし" }),
              el("td", { text: f.score === null ? "－" : `${f.score}点` }),
              el("td", {
                class: f.score === null ? "" : f.score >= exam.fieldPass ? "ok" : "ng",
                text: f.score === null ? "－" : f.score >= exam.fieldPass ? "○" : `× ${exam.fieldPass}点未満`,
              }),
            ]))),
          ])
        : null,
      el("p", { class: "field-hint", text: "※ 点数は正答率から計算した目安です。" }),
    ]);
  }

  // ======================================================================
  // 設定
  // ======================================================================

  function settingsMenuScreen() {
    return el("section", {}, [
      el("h2", { text: "設定" }),
      el("p", { class: "lead", text: "項目を選んでください。" }),
      el("div", { class: "list" }, [
        listItem("サウンド", "", () => go(soundScreen), { desc: "ゲームの音量・ボタンのクリック音の音量" }),
        listItem("カラー", "", () => go(colorScreen), { desc: "画面の色（テーマ・アクセントカラー・背景色）" }),
        listItem("問題一覧", "", () => go(catalogScreen), { desc: "すべての用語と問題を見る" }),
        listItem("実績", "準備中", null, { desc: "これまでの記録", disabled: true }),
        listItem("お問い合わせ", "準備中", null, { desc: "不具合の報告・ご意見", disabled: true }),
      ]),
    ]);
  }

  function soundScreen() {
    function slider(key, label, desc, testSound) {
      const value = el("span", { class: "range-value", text: `${sound[key]}` });
      const input = el("input", { type: "range", min: 0, max: 100, step: 5, value: sound[key], "aria-label": label });
      input.addEventListener("input", () => {
        sound[key] = Number(input.value);
        value.textContent = `${sound[key]}`;
        saveJSON(SOUND_KEY, sound);
      });
      input.addEventListener("change", () => playSound(testSound));
      return el("div", { class: "field" }, [
        el("span", { class: "field-label", text: label }),
        el("div", { class: "range-row" }, [
          input,
          value,
          el("button", { class: "small-btn", type: "button", text: "試しに鳴らす", "data-silent": "1", onclick: () => playSound(testSound) }),
        ]),
        el("p", { class: "field-hint", text: desc }),
      ]);
    }
    return el("section", {}, [
      el("h2", { text: "サウンド" }),
      el("p", { class: "lead", text: "0 にすると音が鳴らなくなります。設定は自動で保存されます。" }),
      el("div", { class: "card" }, [
        slider("game", "ゲームの音量", "正解・不正解、試験の開始・終了、残り時間が少なくなったときの音。", "correct"),
        slider("click", "クリック音の音量", "ボタンなどを押したときの音。", "click"),
      ]),
    ]);
  }

  function colorScreen() {
    const ACCENTS = [
      ["", "標準"], ["#3b6fe0", "青"], ["#1f9d55", "緑"], ["#7c4dff", "紫"],
      ["#e07b1f", "オレンジ"], ["#d64545", "赤"], ["#d6458f", "ピンク"], ["#0e9aa7", "水色"],
    ];
    const BACKGROUNDS = [
      ["", "標準"], ["#ffffff", "白"], ["#f5f6f8", "明るい灰色"], ["#eef6ee", "うすい緑"], ["#eaf1fb", "うすい青"],
      ["#fdf6e3", "クリーム"], ["#15171c", "黒に近い灰色"], ["#0f1626", "紺"], ["#000000", "黒"],
    ];
    const root = el("section");

    function save() {
      saveJSON(COLOR_KEY, color);
      applyColor();
      render();
    }

    function swatches(list, current, onPick) {
      return el("div", { class: "swatches" }, list.map(([value, name]) =>
        el("button", {
          type: "button",
          class: `swatch${value === current ? " active" : ""}${value ? "" : " default"}`,
          title: name,
          "aria-label": name,
          style: value ? `--swatch:${value}` : null,
          onclick: () => onPick(value),
        }, value ? null : el("span", { text: "標準" }))
      ));
    }

    function picker(current, fallback, onPick) {
      const input = el("input", { type: "color", value: current || fallback, class: "color-input" });
      input.addEventListener("change", () => onPick(input.value));
      return el("label", { class: "inline color-pick" }, [input, "自由に選ぶ"]);
    }

    function render() {
      const themeSeg = el("div", { class: "segmented" }, [["auto", "自動（端末に合わせる）"], ["light", "ライト"], ["dark", "ダーク"]].map(([v, label]) =>
        el("button", {
          type: "button", class: color.theme === v ? "active" : "", text: label,
          onclick: () => { color.theme = v; save(); },
        })
      ));
      setChildren(root,
        el("h2", { text: "カラー" }),
        el("p", { class: "lead", text: "画面の色を変えられます。設定は自動で保存されます。" }),
        el("div", { class: "card" }, [
          el("div", { class: "field" }, [
            el("span", { class: "field-label", text: "テーマ" }),
            themeSeg,
            el("p", { class: "field-hint", text: "文字やボタンなど、画面全体の明るさ。" }),
          ]),
          el("div", { class: "field" }, [
            el("span", { class: "field-label", text: "アクセントカラー（ボタン・選択中の項目・CBT画面の帯の色）" }),
            swatches(ACCENTS, color.accent, (v) => { color.accent = v; save(); }),
            picker(color.accent, "#3b6fe0", (v) => { color.accent = v; save(); }),
          ]),
          el("div", { class: "field" }, [
            el("span", { class: "field-label", text: "背景色" }),
            swatches(BACKGROUNDS, color.bg, (v) => {
              color.bg = v;
              if (v) color.theme = luminance(v) < 0.5 ? "dark" : "light"; // 背景に合わせて文字が読める明るさにする
              save();
            }),
            picker(color.bg, "#f5f6f8", (v) => { color.bg = v; color.theme = luminance(v) < 0.5 ? "dark" : "light"; save(); }),
            el("p", { class: "field-hint", text: "背景色を選ぶと、文字が読みやすいようにテーマも自動で切り替わります。" }),
          ]),
          el("div", { class: "color-preview" }, [
            el("span", { class: "field-label", text: "見本" }),
            el("div", { class: "cbt" }, [
              el("div", { class: "cbt-head" }, [el("span", { class: "cbt-num", text: "問1" }), el("span", { class: "cbt-count", text: "/ 10問" })]),
              el("div", { class: "cbt-body preview-body" }, [
                el("div", { class: "choices" }, [
                  (() => { const b = choiceButton(0, "選択中の選択肢", null); b.classList.add("selected"); return b; })(),
                  choiceButton(1, "ほかの選択肢", null),
                ]),
              ]),
            ]),
          ]),
        ]),
        el("div", { class: "actions" }, [
          el("button", {
            class: "secondary-btn", type: "button", text: "標準の色に戻す",
            onclick: () => { color.theme = "auto"; color.accent = ""; color.bg = ""; save(); },
          }),
        ])
      );
    }

    render();
    return root;
  }

  // 問題一覧：すべての用語と、その問題（正解つき）を見る
  function catalogScreen() {
    const listArea = el("div");
    let query = "";

    function termDetail(term) {
      const details = el("details", { class: "catalog-term" }, [
        el("summary", {}, [
          el("span", { class: "catalog-name", text: term.name }),
          el("span", { class: "catalog-count", text: `${term.items.length}問` }),
          term.description ? el("span", { class: "catalog-desc", text: term.description }) : null,
        ]),
      ]);
      // 中身は開いたときに作る（用語が多くても軽く表示するため）
      details.addEventListener("toggle", () => {
        if (!details.open || details.dataset.built) return;
        details.dataset.built = "1";
        details.append(el("div", { class: "catalog-body" }, [
          term.explanation ? el("p", { class: "catalog-explain", text: term.explanation }) : null,
          term.items.length
            ? el("ol", { class: "catalog-questions" }, term.items.map((q) =>
                el("li", {}, [
                  levelBadge(q),
                  el("p", { class: "q", text: q.question }),
                  el("ul", { class: "catalog-choices" }, q.choices.map((c, i) =>
                    el("li", { class: i === q.answer ? "ok" : "" }, [
                      el("span", { class: "reason-mark", text: i === q.answer ? "○" : "" }),
                      `${MARKS[i]}　${c}`,
                    ])
                  )),
                  explanationBlock(q) ? el("details", { class: "review-explain" }, [el("summary", { text: "解説を見る" }), explanationBlock(q)]) : null,
                ])
              ))
            : el("p", { class: "field-hint", text: "この用語の問題はまだありません。" }),
        ]));
      });
      return details;
    }

    function render() {
      const q = query.trim().toLowerCase();
      const match = (t) => !q || [t.name, t.description, t.category, ...t.items.map((i) => i.question)].some((s) => s && s.toLowerCase().includes(q));
      const blocks = [];
      let termCount = 0;
      let questionCount = 0;
      for (const genre of GENRES) {
        for (const category of genre.categories) {
          const terms = category.terms.filter(match);
          if (!terms.length) continue;
          termCount += terms.length;
          questionCount += terms.reduce((n, t) => n + t.items.length, 0);
          blocks.push(el("div", { class: "catalog-category" }, [
            el("h3", { class: "catalog-heading", text: `${genre.name} ／ ${category.name}` }),
            ...terms.map(termDetail),
          ]));
        }
      }
      setChildren(listArea,
        el("p", { class: "lead", text: `${q ? "検索結果：" : ""}用語 ${termCount}語・問題 ${questionCount}問` }),
        ...(blocks.length ? blocks : [el("div", { class: "empty", text: "見つかりませんでした。" })])
      );
    }

    const search = el("input", { type: "search", class: "search", placeholder: "用語名・説明・問題文で検索", "aria-label": "問題一覧を検索" });
    search.addEventListener("input", () => { query = search.value; render(); });
    render();
    return el("section", {}, [
      el("h2", { text: "問題一覧" }),
      search,
      listArea,
    ]);
  }

  // ======================================================================
  // 単語カード（自分で作る単語帳。いくつでも作れる）
  // ======================================================================

  // 単語帳: { id, name, cards: [{ id, front, back }], removed: [削除した単語], random, backFirst }
  const WORDBOOKS_KEY = "remember.wordbooks";
  const wordbooks = loadJSON(WORDBOOKS_KEY, []).filter((b) => b && Array.isArray(b.cards));
  wordbooks.forEach((b) => { if (!Array.isArray(b.removed)) b.removed = []; });
  const saveWordbooks = () => saveJSON(WORDBOOKS_KEY, wordbooks);
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const findBook = (id) => wordbooks.find((b) => b.id === id);

  function missingBook() {
    return el("section", { class: "center-screen" }, [
      el("h2", { text: "単語帳が見つかりません" }),
      el("p", { class: "lead", text: "削除された可能性があります。" }),
      el("div", { class: "actions narrow" }, [
        el("button", { class: "secondary-btn", type: "button", text: "戻る", onclick: back }),
      ]),
    ]);
  }

  function wordbookListScreen() {
    const nameInput = el("input", { type: "text", class: "text-input", placeholder: "新しい単語帳の名前", maxlength: 30 });
    function create() {
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); return; }
      const book = { id: newId(), name, cards: [], removed: [], random: false, backFirst: false };
      wordbooks.push(book);
      saveWordbooks();
      go(wordbookScreen, book.id);
    }
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) create(); });

    return el("section", {}, [
      el("h2", { text: "単語カード" }),
      el("p", { class: "lead", text: "自分で単語を登録して、カードをめくって覚えます。単語帳はいくつでも作れます。" }),
      wordbooks.length
        ? el("div", { class: "list" }, wordbooks.map((b) =>
            listItem(b.name, `${b.cards.length}語`, () => go(wordbookScreen, b.id), {
              desc: b.cards.slice(0, 4).map((c) => c.front).join("・") || "まだ単語がありません",
            })
          ))
        : el("div", { class: "empty", text: "まだ単語帳がありません。下から作ってください。" }),
      el("div", { class: "inline new-tag" }, [
        nameInput,
        el("button", { class: "small-btn", type: "button", text: "単語帳を作る", onclick: create }),
      ]),
      el("p", { class: "field-hint", text: "単語帳はこのブラウザに保存されます（端末・ブラウザごとに別々）。" }),
    ]);
  }

  function wordbookScreen(id) {
    const book = findBook(id);
    if (!book) return missingBook();
    const root = el("section");
    let editingId = null;   // 編集中の単語
    let termQuery = "";
    let termOpen = false;

    const hasFront = (front) => book.cards.some((c) => c.front === front);

    function addCard(front, back) {
      front = front.trim();
      back = back.trim();
      if (!front) return false;
      if (hasFront(front) && !confirm(`「${front}」はすでに登録されています。もう1枚追加しますか？`)) return false;
      book.cards.push({ id: newId(), front, back });
      saveWordbooks();
      return true;
    }

    function cardText(card) {
      return el("div", { class: "manage-body" }, [
        el("p", { class: "wb-front", text: card.front }),
        card.back ? el("p", { class: "wb-back", text: card.back }) : el("p", { class: "wb-back", text: "（意味なし）" }),
      ]);
    }

    function cardRow(card) {
      if (card.id === editingId) {
        const f = el("input", { type: "text", class: "text-input", value: card.front, maxlength: 100, "aria-label": "単語" });
        const b = el("textarea", { class: "text-input", rows: 3, maxlength: 1000, "aria-label": "意味" });
        b.value = card.back;
        const save = () => {
          if (!f.value.trim()) { f.focus(); return; }
          card.front = f.value.trim();
          card.back = b.value.trim();
          saveWordbooks();
          editingId = null;
          render();
        };
        b.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save(); });
        f.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) save(); });
        setTimeout(() => f.focus());
        return el("div", { class: "manage-item wb-editing" }, [
          el("div", { class: "wb-form manage-body" }, [f, b]),
          el("div", { class: "wb-btns" }, [
            el("button", { class: "small-btn", type: "button", text: "保存", onclick: save }),
            el("button", { class: "small-btn", type: "button", text: "やめる", onclick: () => { editingId = null; render(); } }),
          ]),
        ]);
      }
      return el("div", { class: "manage-item" }, [
        cardText(card),
        el("div", { class: "wb-btns" }, [
          el("button", { class: "small-btn", type: "button", text: "編集", onclick: () => { editingId = card.id; render(); } }),
          el("button", {
            class: "small-btn danger", type: "button", text: "削除", title: "単語帳から外す（下の「削除した単語」から入れなおせます）",
            onclick: () => {
              book.cards = book.cards.filter((c) => c !== card);
              book.removed.unshift(card);
              saveWordbooks();
              render();
            },
          }),
        ]),
      ]);
    }

    function render() {
      // 名前の変更・単語帳の削除
      const nameInput = el("input", { type: "text", class: "text-input", value: book.name, maxlength: 30 });
      const rename = () => {
        const to = nameInput.value.trim();
        if (!to || to === book.name) return;
        book.name = to;
        saveWordbooks();
        render();
      };
      nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) rename(); });

      // 単語を追加
      const frontInput = el("input", { type: "text", class: "text-input", placeholder: "単語（カードの表）", maxlength: 100 });
      const backInput = el("textarea", { class: "text-input", rows: 3, placeholder: "意味・説明（カードの裏）", maxlength: 1000 });
      const add = () => {
        if (!frontInput.value.trim()) { frontInput.focus(); return; }
        if (!addCard(frontInput.value, backInput.value)) return;
        render();
        root.querySelector(".wb-new-front").focus();
      };
      frontInput.classList.add("wb-new-front");
      frontInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); backInput.focus(); }
      });
      backInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) add(); });

      // ゲームの用語から追加
      const q = termQuery.trim().toLowerCase();
      const terms = q ? TERMS.filter((t) => t.name.toLowerCase().includes(q)) : TERMS;
      const termSearch = el("input", { type: "search", class: "text-input wb-term-search", placeholder: "用語名で絞り込み", value: termQuery });
      termSearch.addEventListener("input", () => {
        termQuery = termSearch.value;
        render();
        const s = root.querySelector(".wb-term-search");
        s.focus();
        s.setSelectionRange(s.value.length, s.value.length);
      });
      const termArea = el("details", { class: "add-area", open: termOpen }, [
        el("summary", { text: `ゲームの用語から追加する（${TERMS.length}語から）` }),
        termSearch,
        terms.length
          ? el("div", { class: "manage-list" }, terms.map((t) => {
              const added = hasFront(t.name);
              return el("div", { class: "manage-item" }, [
                el("div", { class: "manage-body" }, [
                  el("div", { class: "manage-meta" }, [el("span", { text: `${t.genre} ／ ${t.category}` })]),
                  el("p", { class: "wb-front", text: t.name }),
                  t.description ? el("p", { class: "wb-back", text: t.description }) : null,
                ]),
                el("button", {
                  class: "small-btn", type: "button", text: added ? "追加済み" : "追加", disabled: added,
                  onclick: () => { addCard(t.name, t.description || t.explanation || ""); render(); },
                }),
              ]);
            }))
          : el("div", { class: "empty", text: "一致する用語がありません。" }),
      ]);
      termArea.addEventListener("toggle", () => { termOpen = termArea.open; });

      const option = (key, label) => {
        const box = el("input", { type: "checkbox", checked: !!book[key] });
        box.addEventListener("change", () => { book[key] = box.checked; saveWordbooks(); });
        return el("label", { class: "check" }, [box, label]);
      };

      setChildren(
        root,
        el("h2", { text: book.name }),
        el("p", { class: "lead", text: `${book.cards.length}語` }),
        el("div", { class: "card" }, [
          el("button", {
            class: "primary-btn", type: "button", text: "カードで覚える", disabled: book.cards.length === 0,
            onclick: () => go(flashcardScreen, book.id, null),
          }),
          el("div", { class: "wb-options" }, [
            option("random", "ランダムな順番"),
            option("backFirst", "意味を先に見せる"),
          ]),
        ]),

        el("h2", { text: "単語を追加", class: "section-gap" }),
        el("div", { class: "card wb-form" }, [
          frontInput,
          backInput,
          el("div", { class: "inline wb-add-row" }, [
            el("span", { class: "field-hint", text: "Enter で意味へ、Ctrl + Enter で追加" }),
            el("button", { class: "small-btn", type: "button", text: "追加する", onclick: add }),
          ]),
        ]),
        termArea,

        el("h2", { text: `登録した単語（${book.cards.length}語）`, class: "section-gap" }),
        book.cards.length
          ? el("div", { class: "manage-list" }, book.cards.map(cardRow))
          : el("div", { class: "empty", text: "まだ単語がありません。上の「単語を追加」から登録できます。" }),

        book.removed.length
          ? el("div", { class: "section-gap" }, [
              el("div", { class: "wb-removed-head" }, [
                el("h2", { text: `削除した単語（${book.removed.length}語）` }),
                el("div", { class: "wb-btns" }, [
                  el("button", {
                    class: "small-btn", type: "button", text: "すべて入れなおす",
                    onclick: () => { book.cards.push(...book.removed); book.removed = []; saveWordbooks(); render(); },
                  }),
                  el("button", {
                    class: "small-btn danger", type: "button", text: "すべて完全に削除",
                    onclick: () => {
                      if (!confirm(`削除した単語${book.removed.length}語を完全に削除しますか？（元に戻せません）`)) return;
                      book.removed = [];
                      saveWordbooks();
                      render();
                    },
                  }),
                ]),
              ]),
              el("p", { class: "lead", text: "「入れなおす」で単語帳に戻せます。" }),
              el("div", { class: "manage-list" }, book.removed.map((card) =>
                el("div", { class: "manage-item wb-removed" }, [
                  cardText(card),
                  el("div", { class: "wb-btns" }, [
                    el("button", {
                      class: "small-btn", type: "button", text: "入れなおす",
                      onclick: () => {
                        book.removed = book.removed.filter((c) => c !== card);
                        book.cards.push(card);
                        saveWordbooks();
                        render();
                      },
                    }),
                    el("button", {
                      class: "small-btn danger", type: "button", text: "完全に削除",
                      onclick: () => {
                        if (!confirm(`「${card.front}」を完全に削除しますか？（元に戻せません）`)) return;
                        book.removed = book.removed.filter((c) => c !== card);
                        saveWordbooks();
                        render();
                      },
                    }),
                  ]),
                ])
              )),
            ])
          : null,

        el("h2", { text: "単語帳の設定", class: "section-gap" }),
        el("div", { class: "card tag-settings" }, [
          el("span", { class: "field-label", text: "単語帳の名前" }),
          el("div", { class: "inline" }, [
            nameInput,
            el("button", { class: "small-btn", type: "button", text: "変更", onclick: rename }),
            el("button", {
              class: "small-btn danger", type: "button", text: "単語帳を削除",
              onclick: () => {
                if (!confirm(`単語帳「${book.name}」を削除しますか？（入っている単語もすべて消え、元に戻せません）`)) return;
                wordbooks.splice(wordbooks.indexOf(book), 1);
                saveWordbooks();
                back();
              },
            }),
          ]),
        ])
      );
    }

    render();
    return root;
  }

  // カードをめくって覚える。onlyIds を渡すとその単語だけ（「まだ」の単語のやり直し）
  function flashcardScreen(id, onlyIds) {
    const book = findBook(id);
    if (!book) return missingBook();
    let deck = onlyIds ? book.cards.filter((c) => onlyIds.includes(c.id)) : book.cards.slice();
    if (book.random) deck = shuffle(deck);
    const known = new Map(); // カードid → true(覚えた) / false(まだ)
    let index = 0;
    let flipped = false;
    const root = el("section");

    function mark(value) {
      known.set(deck[index].id, value);
      playSound(value ? "correct" : "wrong");
      next();
    }
    function next() {
      if (index < deck.length - 1) { index++; flipped = false; render(); }
      else finish();
    }

    function finish() {
      const notYet = deck.filter((c) => known.get(c.id) !== true);
      const okCount = deck.length - notYet.length;
      playSound("finish");
      setChildren(
        root,
        el("div", { class: "center-screen" }, [
          el("h2", { text: "おつかれさまでした" }),
          el("p", { class: "lead", text: `${deck.length}枚のうち、覚えた ${okCount}枚 ／ まだ ${notYet.length}枚` }),
          notYet.length
            ? el("div", { class: "manage-list wb-result" }, notYet.map((c) =>
                el("div", { class: "manage-item" }, [
                  el("div", { class: "manage-body" }, [
                    el("p", { class: "wb-front", text: c.front }),
                    c.back ? el("p", { class: "wb-back", text: c.back }) : null,
                  ]),
                ])
              ))
            : null,
          el("div", { class: "actions narrow" }, [
            notYet.length
              ? el("button", {
                  class: "primary-btn", type: "button", text: "「まだ」の単語だけもう一度",
                  onclick: () => replace(flashcardScreen, id, notYet.map((c) => c.id)),
                })
              : null,
            el("button", { class: "secondary-btn", type: "button", text: "最初からもう一度", onclick: () => replace(flashcardScreen, id, null) }),
            el("button", { class: "secondary-btn", type: "button", text: "単語帳に戻る", onclick: back }),
          ]),
        ])
      );
    }

    function render() {
      if (!deck.length) { finish(); return; }
      const card = deck[index];
      const showBack = flipped !== !!book.backFirst; // 「意味を先に見せる」なら裏から
      const state = known.get(card.id);
      setChildren(
        root,
        el("div", { class: "flash-top" }, [
          el("span", { text: book.name }),
          el("span", { text: `${index + 1} / ${deck.length}` }),
        ]),
        el("button", {
          class: `flashcard${flipped ? " flipped" : ""}${showBack ? " is-back" : ""}`, type: "button", "data-key": "flip",
          onclick: () => { flipped = !flipped; render(); },
        }, [
          el("span", { class: "flashcard-side", text: showBack ? "意味" : "単語" }),
          el("span", { class: "flashcard-text", text: (showBack ? card.back : card.front) || "（意味なし）" }),
          el("span", { class: "flashcard-hint", text: "クリック（Space）で裏返す" }),
        ]),
        el("div", { class: "flash-mark" }, [
          el("button", { class: `secondary-btn${state === false ? " picked" : ""}`, type: "button", text: "まだ", onclick: () => mark(false) }),
          el("button", { class: `primary-btn${state === true ? " picked" : ""}`, type: "button", text: "覚えた", onclick: () => mark(true) }),
        ]),
        el("div", { class: "flash-nav" }, [
          el("button", {
            class: "small-btn", type: "button", text: "← 前へ", "data-key": "prev", disabled: index === 0,
            onclick: () => { index--; flipped = false; render(); },
          }),
          el("button", { class: "small-btn", type: "button", text: index === deck.length - 1 ? "終わる" : "次へ →", "data-key": "next", onclick: next }),
        ])
      );
    }

    render();
    return root;
  }

  // ヘッダーの「remember」を押すとタイトル画面に戻る
  const headerTitle = document.querySelector(".app-title");
  headerTitle.title = "タイトルに戻る";
  headerTitle.addEventListener("click", () => {
    if (history.length > 1) window.history.go(1 - history.length);
  });

  history.push([titleScreen, []]); // 最初の画面（タイトル）はブラウザの履歴に積まない
  show();
})();
