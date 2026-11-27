// デモモード用の「送り先」（サーバーなし。データはこの端末の中だけに保存する）
// config.js に Supabase の設定がないときに使う。共有・ほかの端末との同期はできない。

export function createLocalBackend() {
  const notAvailable = async () => {
    throw new Error('デモモードでは使えません（SETUP.md の手順で Supabase を設定してください）');
  };
  return {
    mode: 'local',
    async exec() { return { ok: true }; }, // 端末の中のデータがすべてなので、送る先はない
    async pull() { return null; },
    async downloadPhoto() { return null; },
    async subscribe() { return () => {}; },
    invite: notAvailable,
    cancelInvite: notAvailable,
    removeMember: notAvailable,
  };
}
