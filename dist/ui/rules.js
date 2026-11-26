import { db } from '../db/schema.js';
import { MIN_DEPOSIT_JPY, MIN_WITHDRAW_JPY, LTC_NETWORK_FEE_JPY } from '../payments/limits.js';
import { emoji } from './emoji-ids.js';
import { COLOR, ICON, panelEmbed } from './theme.js';
db.exec(`CREATE TABLE IF NOT EXISTS rules_config (
  guild_id          TEXT PRIMARY KEY,
  ticket_channel_id TEXT NOT NULL,
  verify_channel_id TEXT NOT NULL,
  updated_at        INTEGER NOT NULL
);`);
export function getRulesConfig(guildId) {
    const r = db.prepare('SELECT ticket_channel_id, verify_channel_id, updated_at FROM rules_config WHERE guild_id=?').get(guildId);
    return r ? { ticketChannelId: r.ticket_channel_id, verifyChannelId: r.verify_channel_id, updatedAt: r.updated_at } : null;
}
export function setRulesConfig(guildId, ticketChannelId, verifyChannelId) {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT INTO rules_config(guild_id, ticket_channel_id, verify_channel_id, updated_at) VALUES (?,?,?,?)
    ON CONFLICT(guild_id) DO UPDATE SET ticket_channel_id=excluded.ticket_channel_id,
      verify_channel_id=excluded.verify_channel_id, updated_at=excluded.updated_at`)
        .run(guildId, ticketChannelId, verifyChannelId, now);
    return { ticketChannelId, verifyChannelId, updatedAt: now };
}
const R = {
    book: () => emoji('rule_book') || ICON.crown(),
    check: () => emoji('rule_check') || ICON.check(),
    shield: () => emoji('rule_shield') || ICON.crown(),
    warn: () => emoji('rule_warn') || ICON.crown(),
    ticket: () => emoji('rule_ticket') || ICON.crown(),
    ban: () => emoji('rule_ban') || ICON.crown(),
};
const yen = (n) => `¥${n.toLocaleString()}`;
/** 規約の本文。Discord の上限 (1 メッセージの embed 合計 6000 文字) に収まるよう 3 枚に分ける。 */
export function rulesPanel(cfg) {
    const ticket = `<#${cfg.ticketChannelId}>`;
    const verify = `<#${cfg.verifyChannelId}>`;
    const first = panelEmbed({
        icon: R.book(), title: '利用規約', tagline: 'すべての利用は自己責任です。ご利用前に必ずお読みください',
        color: COLOR.violet, deco: '',
        sections: [
            { icon: R.check(), title: '第1条  適用と同意', lines: [
                    '本規約は、本サーバーと Bot のすべての機能 (ゲーム・入金・出金など) に適用されます',
                    `${verify} で認証を済ませた時点で、本規約のすべてに同意したものとみなします`,
                    '内容を確認していないことを理由に、規約の適用を拒むことはできません',
                ] },
            { icon: R.shield(), title: '第2条  自己責任', lines: [
                    '本サービスの利用は、すべて利用者自身の判断と責任で行うものとします',
                    'お住まいの地域の法令や年齢制限は、利用者が自分で確認してください。未成年の利用は禁止します',
                    '利用によって生じた損失やトラブルについて、運営は一切の責任を負いません',
                ] },
            { icon: ICON.chip(), title: '第3条  chip と残高', lines: [
                    '1 chip = ¥1。chip は本サーバーの中でだけ使えます',
                    'chip の譲渡・売買・貸し借りはできません',
                    '残高は PayPay 由来 と LTC 由来 に分けて管理し、出金は入金した方法の分までです',
                    '残高やゲームの結果は、Bot の記録を正しいものとします',
                ] },
        ],
    });
    const second = panelEmbed({
        icon: '', title: '', tagline: '', color: COLOR.purple, deco: '',
        sections: [
            { icon: ICON.wallet(), title: '第4条  入金と出金', lines: [
                    `最低額: 入金 PayPay ${yen(MIN_DEPOSIT_JPY.paypay)} / LTC ${yen(MIN_DEPOSIT_JPY.ltc)}、出金 PayPay ${yen(MIN_WITHDRAW_JPY.paypay)} / LTC ${yen(MIN_WITHDRAW_JPY.ltc)}`,
                    `LTC の出金は手数料 ${yen(LTC_NETWORK_FEE_JPY)} を差し引きます`,
                    'LTC の入金は、表示された量をぴったり、期限内に送ってください',
                    '金額・送金先の間違い、期限切れ、取引所の手数料による不足などの送金ミスは自己責任です',
                    '不正の疑いがある入出金は、確認が終わるまで保留・取り消しすることがあります',
                ] },
            { icon: R.warn(), title: '第5条  禁止事項', lines: [
                    '複数のアカウントでの利用 (サブアカウント)',
                    '不具合や仕様の穴を利用して chip を得ること',
                    '自動操作ツール・マクロ・改造したアプリでの操作',
                    '他人の名義・盗んだ決済手段での入金、送金の取り消し',
                    '「入金されていない」などの**虚偽の報告**',
                    '**スクリーンショットや送金記録の改ざん・偽造**',
                    'アカウントや chip の売買・貸し借り、外部での取引',
                    '運営になりすます行為、他の利用者への詐欺・嫌がらせ・脅し',
                    'スパム・荒らし、その他運営が不適切と判断する行為',
                ] },
            { icon: R.ticket(), title: '第6条  不具合・お問い合わせ', lines: [
                    `不具合や入出金のトラブルは ${ticket} でチケットを作成してください`,
                    '日時・ゲーム名 / 入出金の方法・金額・送金番号や送金リンクを添えてください',
                    'DM や他のチャンネルでの問い合わせには対応しません',
                    '不具合を見つけたら、使わずにすぐ報告してください',
                ] },
        ],
    });
    const third = panelEmbed({
        icon: '', title: '', tagline: '', color: COLOR.violet, deco: '',
        sections: [
            { icon: R.book(), title: '第7条  記録と判断', lines: [
                    '運営は、すべての入金・出金・ゲームの記録を保存しています',
                    '問い合わせやトラブルは、運営の記録をもとに判断します',
                    'スクリーンショットだけを根拠にした請求には応じません',
                    '不具合で生じた chip や結果は、運営の判断で訂正・取り消しします',
                ] },
            { icon: R.ban(), title: '第8条  違反したとき', lines: [
                    '予告なく、残高の没収・出金の停止・利用停止・BAN を行うことがあります',
                    '違反によって運営に損害が出た場合は、その賠償を求めます',
                    '処分の理由を説明する義務は負いません',
                ] },
            { icon: ICON.balance(), title: '第9条  免責', lines: [
                    'Discord・PayPay・LTC ネットワークの障害、レートの変動、通信の不具合による損失は補償しません',
                    'BET の上限は運営の残高によって変わります',
                    'サービスの内容は、予告なく変更・停止・終了することがあります',
                ] },
            { icon: ICON.sparkle(), title: '第10条  規約の変更', lines: [
                    '運営は、本規約をいつでも変更できます',
                    '変更後の規約は、このパネルに掲示した時点で効力を持ちます',
                    '変更後に利用を続けた場合、変更に同意したものとみなします',
                    '本規約に書かれていないことは、運営の判断を最終のものとします',
                ] },
        ],
        footer: 'C4sino · 利用規約',
    });
    // 2 枚目以降は見出しを付けない (1 枚の規約として続けて読めるように)
    for (const e of [second, third]) {
        const d = e.data.description;
        e.setDescription(d.slice(d.indexOf('### ')));
    }
    third.setDescription(`${third.data.description}\n\n-# 最終更新 <t:${cfg.updatedAt}:D>`);
    return { embeds: [first, second, third] };
}
