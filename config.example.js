// Supabase の接続情報（サンプル）
// 使い方：このファイルをコピーして「config.js」という名前にし、下の2つを自分のプロジェクトの値に書き換える。
//   値は Supabase の画面「Project Settings → API Keys / Data API」で確認できる（SETUP.md の手順 3）。
//   - supabaseUrl     … Project URL（https://xxxx.supabase.co の形）
//   - supabaseAnonKey … anon（public）キー、または Publishable キー
//                       ブラウザに見えてもよい「公開用の鍵」。データは RLS（行ごとの権限）で守られる。
// ※ service_role キー・secret キー（秘密の鍵）は、絶対にここへ書かないこと。
// ※ 2つとも空のままにすると「デモモード」（この端末の中だけに保存）で動く。
window.KAIMONO_CONFIG = {
  supabaseUrl: 'https://YOUR-PROJECT-REF.supabase.co',
  supabaseAnonKey: 'YOUR-ANON-KEY',
};
