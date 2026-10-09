// アプリ側の固定設定。ゲームの数値はここではなく assets/config/game.json に書く。
window.MR = window.MR || {};

MR.CONFIG = {
  // ゲームデータ（manifest.json 以下）を置いているサーバー。末尾スラッシュなし。
  //   例: 'https://<ユーザー名>.github.io/Mirrsona/assets'
  //   例: 'https://example.com/mirrsona-assets'
  // 空の場合: Web で動いているときはページと同じ場所の assets/ を使い、
  //           アプリ内（ネイティブ）では内蔵データ（defaults.js）で起動する。
  ASSET_SERVER: '',

  // アプリ内（ネイティブ、capacitor://）で動いているときだけ使うサーバー。ASSET_SERVER が空のとき有効。
  // Web 版は同じページの assets/ を使うので、ローカルの動作確認や Pages の Web 版には影響しない。
  // 配信先は .github/workflows/deploy-pages.yml の SITE_REPO（公開リポジトリの GitHub Pages）
  NATIVE_ASSET_SERVER: 'https://nyachill.github.io/mirrsona-site/assets',

  // アプリ本体のバージョン（ゲームデータのバージョンとは別物）
  APP_VERSION: '0.1.0',

  // サーバーの応答待ち、および本文の受信が止まったままでいられる上限（ms）。大きなファイルでも
  // 受信が続いている限り切れない。超えたら内蔵／ローカルのデータで起動する（保存できた分は次回再開に使う）
  FETCH_TIMEOUT_MS: 12000,

  // アセットの品質ティア。manifest の path 先頭が hd/ or sd/ のものはそのティアの端末だけがダウンロードする。
  //   'auto' … タッチ端末（iPhone / iPad）は 'sd'、それ以外（PC）は 'hd'
  //   'hd' / 'sd' … 固定
  //   URL の ?tier=hd|sd があればそちらが優先（動作確認用）
  ASSET_TIER: 'auto',

  // ダウンロードした大きいバイナリ（テクスチャ・モデル・音）はデコード後にメモリから捨てる。
  // このサイズ（バイト）以下のものだけ ArrayBuffer のまま保持する
  //   1 MB だと 1 MB 以下の mp3・GLB・画像の生データ（約 30 MB）がずっと残っていた。64 KB（JSON と小さい物だけ）
  KEEP_BLOB_BYTES: 64 * 1024,

  // true にすると画面左上に FPS とデバッグ情報を出す
  DEBUG: false,

  // 自動テスト用（tools/smoke-test.js が true にする）: ソロで死んだときに「復活する場所」を出さず、今まで通り
  //   player.respawnDelay 秒後にその場で決めた場所（_respawnPlayer()）へ戻す。ふつうは false
  AUTO_RESPAWN: false
};
