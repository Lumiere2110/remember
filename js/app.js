(() => {
  "use strict";

  const GENRES = window.GENRES || [];
  const TERMS = window.TERMS || [];
  const MARKS = ["A", "B", "C", "D"];
  const SETTINGS_KEY = "remember.settings";

  const TIME_OPTIONS = [0, 10, 20, 30, 60]; // 0 = 制限なし
  const DEFAULT_SETTINGS = { timeLimit: 0, count: 0, order: "sequential", shuffleChoices: false };

  const app = document.getElementById("app");
  const backBtn = document.getElementById("back-btn");

  // 画面の履歴。戻るボタンで一つ前の画面に戻る
  const history = [];
  let timerId = null;

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

  function shuffle(array) {
    const a = array.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      return { ...DEFAULT_SETTINGS, ...saved };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings(settings) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // 保存できなくてもゲームは続けられる
    }
  }

  function validQuestions(term) {
    return (term.questions || []).filter(
      (q) => Array.isArray(q.choices) && q.choices.length === 4 && q.answer >= 0 && q.answer < 4
    );
  }

  function termsOf(genreId, categoryId) {
    return TERMS.filter((t) => t.genre === genreId && (!categoryId || t.category === categoryId));
  }

  function stopTimer() {
    if (timerId) cancelAnimationFrame(timerId);
    timerId = null;
  }

  // ---------- 画面遷移 ----------

  function go(screen, ...args) {
    history.push([screen, args]);
    show();
  }

  function back() {
    history.pop();
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

  // ---------- ジャンル選択 ----------

  function genreScreen() {
    const items = GENRES.map((g) => {
      const count = termsOf(g.id).length;
      return el("button", { class: "list-item", type: "button", onclick: () => go(categoryScreen, g) }, [
        el("span", { text: g.name }),
        el("span", { class: "sub", text: `${g.categories.length}カテゴリ・${count}語` }),
      ]);
    });
    return el("section", {}, [
      el("h2", { text: "ジャンルを選ぶ" }),
      el("p", { class: "lead", text: "用語のジャンルを選んでください。" }),
      items.length ? el("div", { class: "list" }, items) : el("div", { class: "empty", text: "ジャンルがまだありません。" }),
    ]);
  }

  // ---------- カテゴリ選択 ----------

  function categoryScreen(genre) {
    const items = genre.categories.map((c) => {
      const count = termsOf(genre.id, c.id).length;
      return el("button", { class: "list-item", type: "button", onclick: () => go(termScreen, genre, c) }, [
        el("span", { text: c.name }),
        el("span", { class: "sub", text: `${count}語` }),
      ]);
    });
    return el("section", {}, [
      el("h2", { text: genre.name }),
      el("p", { class: "lead", text: "カテゴリを選んでください。" }),
      el("div", { class: "list" }, items),
    ]);
  }

  // ---------- 用語選択 ----------

  function termScreen(genre, category) {
    const terms = termsOf(genre.id, category.id);
    const items = terms.map((t) => {
      const n = validQuestions(t).length;
      return el("button", { class: "list-item", type: "button", disabled: n === 0, onclick: () => go(settingsScreen, t) }, [
        el("span", {}, [t.name, t.description ? el("span", { class: "desc", text: t.description }) : null]),
        el("span", { class: "sub", text: `${n}問` }),
      ]);
    });
    return el("section", {}, [
      el("h2", { text: category.name }),
      el("p", { class: "lead", text: `${genre.name} ／ 用語を選んでください。` }),
      items.length
        ? el("div", { class: "list" }, items)
        : el("div", { class: "empty", text: "このカテゴリにはまだ用語がありません。data/terms.js に追加してください。" }),
    ]);
  }

  // ---------- 設定 ----------

  function settingsScreen(term) {
    const questions = validQuestions(term);
    const settings = loadSettings();
    if (settings.count > questions.length) settings.count = 0;

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
    const countInput = el("input", {
      type: "number", min: 1, max: questions.length,
      value: settings.count || questions.length,
    });
    const allCheck = el("input", { type: "checkbox", checked: settings.count === 0 });
    countInput.disabled = settings.count === 0;
    allCheck.addEventListener("change", () => { countInput.disabled = allCheck.checked; });

    // 出題順
    const orderSeg = segmented(
      [["sequential", "登録順"], ["random", "ランダム"]],
      settings.order,
      (v) => { settings.order = v; }
    );

    const shuffleCheck = el("input", { type: "checkbox", checked: settings.shuffleChoices });

    function start() {
      settings.count = allCheck.checked
        ? 0
        : Math.min(questions.length, Math.max(1, parseInt(countInput.value, 10) || questions.length));
      settings.shuffleChoices = shuffleCheck.checked;
      saveSettings(settings);

      let list = settings.order === "random" ? shuffle(questions) : questions.slice();
      if (settings.count) list = list.slice(0, settings.count);
      go(quizScreen, term, list, settings);
    }

    return el("section", {}, [
      el("h2", { text: term.name }),
      el("p", { class: "lead", text: `全${questions.length}問 ／ 出題の設定をしてください。` }),
      el("div", { class: "card" }, [
        el("div", { class: "field" }, [
          el("span", { class: "field-label", text: "回答時間（1問あたり）" }),
          timeSeg,
          el("div", { class: "inline", style: "margin-top:8px" }, [customTime, "秒（自由に入力）"]),
        ]),
        el("div", { class: "field" }, [
          el("span", { class: "field-label", text: "問題数" }),
          el("div", { class: "inline" }, [
            el("label", { class: "check" }, [allCheck, "全問"]),
            countInput,
            `問 ／ ${questions.length}問`,
          ]),
        ]),
        el("div", { class: "field" }, [
          el("span", { class: "field-label", text: "出題順" }),
          orderSeg,
        ]),
        el("div", { class: "field" }, [
          el("label", { class: "check" }, [shuffleCheck, "選択肢の並びをシャッフルする"]),
        ]),
      ]),
      el("div", { class: "actions" }, [
        el("button", { class: "primary-btn", type: "button", text: "スタート", onclick: start }),
      ]),
    ]);
  }

  // ---------- クイズ ----------

  function quizScreen(term, questions, settings) {
    const results = [];
    let index = 0;
    const root = el("section");

    function render() {
      stopTimer();
      const q = questions[index];
      // 表示順を作る。order[i] = 元の選択肢番号
      const order = settings.shuffleChoices ? shuffle([0, 1, 2, 3]) : [0, 1, 2, 3];
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
        results.push({ question: q, selected, correct });

        choiceBtns.forEach((btn, i) => {
          btn.disabled = true;
          if (order[i] === q.answer) btn.classList.add("correct");
          else if (order[i] === selected) btn.classList.add("wrong");
        });

        const title = correct ? "正解！" : selected === null ? "時間切れ" : "不正解";
        const isLast = index === questions.length - 1;
        feedbackArea.replaceChildren(
          el("div", { class: `feedback ${correct ? "correct" : "wrong"}` }, [
            el("p", { class: "feedback-title", text: title }),
            correct ? null : el("p", { text: `正解：${q.choices[q.answer]}` }),
            q.explanation ? el("p", { text: q.explanation }) : null,
          ]),
          el("div", { class: "actions" }, [
            el("button", {
              class: "primary-btn", type: "button",
              text: isLast ? "結果を見る" : "次の問題へ",
              onclick: () => {
                if (isLast) {
                  // 戻るで結果からクイズに戻らないよう、履歴を差し替える
                  history.splice(-1, 1, [resultScreen, [term, results, settings]]);
                  show();
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

      root.replaceChildren(
        el("div", { class: "quiz-top" }, [
          el("span", { text: `${term.name}　${index + 1} / ${questions.length}` }),
          timeLabel,
        ]),
        settings.timeLimit ? el("div", { class: "timer" }, [timerBar]) : null,
        el("p", { class: "question-text", text: q.question }),
        el("div", { class: "choices" }, choiceBtns),
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

  // 数字キー 1〜4 / A〜D で回答、Enter で次へ
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    const key = e.key.toUpperCase();
    const i = "1234".indexOf(key) >= 0 ? "1234".indexOf(key) : MARKS.indexOf(key);
    const choices = app.querySelectorAll(".choice");
    if (i >= 0 && choices[i] && !choices[i].disabled) choices[i].click();
  });

  // ---------- 結果 ----------

  function resultScreen(term, results, settings) {
    const correctCount = results.filter((r) => r.correct).length;
    const wrongQuestions = results.filter((r) => !r.correct).map((r) => r.question);
    const rate = Math.round((correctCount / results.length) * 100);

    const review = results.map((r) =>
      el("div", { class: `review-item ${r.correct ? "" : "wrong"}` }, [
        el("p", { class: "q", text: `${r.correct ? "○" : "×"} ${r.question.question}` }),
        el("p", {
          class: "a",
          text: r.correct
            ? `正解：${r.question.choices[r.question.answer]}`
            : `あなたの回答：${r.selected === null ? "時間切れ" : r.question.choices[r.selected]} ／ 正解：${r.question.choices[r.question.answer]}`,
        }),
      ])
    );

    // 戻るでクイズではなく設定画面に戻れるよう、履歴の結果画面を差し替えて遷移する
    function replay(questions) {
      history.splice(-1, 1, [quizScreen, [term, questions, settings]]);
      show();
    }

    return el("section", {}, [
      el("h2", { text: `${term.name} の結果` }),
      el("div", { class: "card score" }, [
        el("div", { class: "score-num", text: `${correctCount} / ${results.length}` }),
        el("div", { class: "score-rate", text: `正答率 ${rate}%` }),
      ]),
      el("div", { class: "actions" }, [
        wrongQuestions.length
          ? el("button", { class: "primary-btn", type: "button", text: `間違えた${wrongQuestions.length}問をもう一度`, onclick: () => replay(wrongQuestions) })
          : null,
        el("button", {
          class: wrongQuestions.length ? "secondary-btn" : "primary-btn", type: "button", text: "同じ設定でもう一度",
          onclick: () => {
            const all = validQuestions(term);
            let list = settings.order === "random" ? shuffle(all) : all.slice();
            if (settings.count) list = list.slice(0, settings.count);
            replay(list);
          },
        }),
        el("button", { class: "secondary-btn", type: "button", text: "設定を変える", onclick: back }),
      ]),
      el("h2", { text: "振り返り", style: "margin-top:28px" }),
      el("div", { class: "review" }, review),
    ]);
  }

  go(genreScreen);
})();
