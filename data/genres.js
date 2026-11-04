// ジャンルとカテゴリの定義
// 新しいジャンル・カテゴリはここに追加する。
// id は terms.js で用語を登録するときに使うので、英数字で重複しないように付ける。
window.GENRES = [
  {
    id: "it",
    name: "情報・テクノロジー",
    categories: [
      { id: "network", name: "ネットワーク" },
      { id: "algorithm", name: "アルゴリズム・プログラミング" },
      { id: "database", name: "データベース" },
      { id: "security", name: "セキュリティ" },
    ],
  },
];
