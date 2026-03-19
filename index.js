"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
  var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});

var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });

const baileys_1 = __importStar(require("@whiskeysockets/baileys"));
const logger_1 = __importDefault(require("@whiskeysockets/baileys/lib/Utils/logger"));
const logger = logger_1.default.child({});
logger.level = 'silent';
const pino = require("pino");
const boom_1 = require("@hapi/boom");
const conf = require("./set");
const axios = require("axios");
let fs = require("fs-extra");
let path = require("path");
const FileType = require('file-type');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const { verifierEtatJid, recupererActionJid } = require("./bdd/antilien");
const { atbverifierEtatJid, atbrecupererActionJid } = require("./bdd/antibot");
let evt = require(__dirname + "/framework/zokou");
const { isUserBanned } = require("./bdd/banUser");
const { isGroupBanned } = require("./bdd/banGroup");
const { isGroupOnlyAdmin } = require("./bdd/onlyAdmin");
const { getWarnCountByJID, ajouterUtilisateurAvecWarnCount, resetWarnCountByJID } = require("./bdd/warn");
let { reagir } = require(__dirname + "/framework/app");

// FIX 1: strip invalid chars from session string (removed broken regex replace)
var session = conf.session.replace(/TIMNASA-MD;;;=>/g, "");
const prefixe = conf.PREFIXE;
const more = String.fromCharCode(8206);
const readmore = more.repeat(4001);

// ============================================================
// AUTH: Write session credentials to auth/creds.json
// ============================================================
async function authentification() {
    try {
        if (!fs.existsSync(__dirname + "/auth/creds.json")) {
            console.log("connexion en cour ...");
            await fs.writeFile(__dirname + "/auth/creds.json", Buffer.from(session, "base64").toString("utf-8"), "utf8");
        } else if (fs.existsSync(__dirname + "/auth/creds.json") && session != "zokk") {
            await fs.writeFile(__dirname + "/auth/creds.json", Buffer.from(session, "base64").toString("utf-8"), "utf8");
        }
    } catch (e) {
        console.log("Session Invalid " + e);
        return;
    }
}
authentification();

// ============================================================
// FIX 2: GROUP METADATA CACHE (avoids hammering the API)
// ============================================================
const groupMetadataCache = {};
const GROUP_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getGroupMetadata(zk, groupId) {
    const now = Date.now();
    const cached = groupMetadataCache[groupId];
    if (cached && (now - cached.timestamp) < GROUP_CACHE_TTL) {
        return cached.data;
    }
    try {
        const metadata = await zk.groupMetadata(groupId);
        groupMetadataCache[groupId] = { data: metadata, timestamp: now };
        return metadata;
    } catch (e) {
        return cached ? cached.data : null;
    }
}

const store = (0, baileys_1.makeInMemoryStore)({
    logger: pino().child({ level: "silent", stream: "store" }),
});

setTimeout(() => {
    async function main() {
        const { version } = await (0, baileys_1.fetchLatestBaileysVersion)();
        const { state, saveCreds } = await (0, baileys_1.useMultiFileAuthState)(__dirname + "/auth");
        const sockOptions = {
            version,
            logger: pino({ level: "silent" }),
            browser: ['Timnasa md', "safari", "1.0.0"],
            printQRInTerminal: true,
            fireInitQueries: false,
            shouldSyncHistoryMessage: false,
            downloadHistory: false,
            syncFullHistory: false,
            generateHighQualityLinkPreview: true,
            markOnlineOnConnect: false,
            keepAliveIntervalMs: 30_000,
            auth: {
                creds: state.creds,
                keys: (0, baileys_1.makeCacheableSignalKeyStore)(state.keys, logger),
            },
            getMessage: async (key) => {
                if (store) {
                    const msg = await store.loadMessage(key.remoteJid, key.id, undefined);
                    return msg?.message || undefined;
                }
                return { conversation: 'An Error Occurred, Repeat Command!' };
            }
        };

        const zk = (0, baileys_1.default)(sockOptions);
        store.bind(zk.ev);

        // ============================================================
        // AUTO-REACT TO STATUS
        // ============================================================
        if (conf.AUTOREACT_STATUS === "yes") {
            zk.ev.on("messages.upsert", async (m) => {
                const { messages } = m;
                for (const message of messages) {
                    if (message.key && message.key.remoteJid === "status@broadcast") {
                        try {
                            const reactionEmojis = ["❤️", "🔥", "👍", "😂", "😮", "😢", "🤔", "👏", "🎉", "🤩"];
                            const randomEmoji = reactionEmojis[Math.floor(Math.random() * reactionEmojis.length)];
                            await zk.readMessages([message.key]);
                            await new Promise(resolve => setTimeout(resolve, 500));
                            await zk.sendMessage(message.key.remoteJid, {
                                react: { text: randomEmoji, key: message.key }
                            });
                            console.log(`Reacted to status from ${message.key.participant} with ${randomEmoji}`);
                            await new Promise(resolve => setTimeout(resolve, 3000));
                        } catch (error) {
                            console.error("Status reaction failed:", error);
                        }
                    }
                }
            });
        }

        // ============================================================
        // MAIN MESSAGE HANDLER
        // ============================================================
        zk.ev.on("messages.upsert", async (m) => {
            const { messages } = m;
            const ms = messages[0];
            if (!ms.message) return;

            // JID decoder helper
            const decodeJid = (jid) => {
                if (!jid) return jid;
                if (/:\d+@/gi.test(jid)) {
                    let decode = (0, baileys_1.jidDecode)(jid) || {};
                    return decode.user && decode.server ? decode.user + '@' + decode.server : jid;
                }
                return jid;
            };

            var mtype = (0, baileys_1.getContentType)(ms.message);
            var texte = mtype == "conversation" ? ms.message.conversation
                : mtype == "imageMessage" ? ms.message.imageMessage?.caption
                : mtype == "videoMessage" ? ms.message.videoMessage?.caption
                : mtype == "extendedTextMessage" ? ms.message?.extendedTextMessage?.text
                : mtype == "buttonsResponseMessage" ? ms?.message?.buttonsResponseMessage?.selectedButtonId
                : mtype == "listResponseMessage" ? ms.message?.listResponseMessage?.singleSelectReply?.selectedRowId
                : mtype == "messageContextInfo" ? (ms?.message?.buttonsResponseMessage?.selectedButtonId || ms.message?.listResponseMessage?.singleSelectReply?.selectedRowId || ms.text)
                : "";

            var origineMessage = ms.key.remoteJid;
            var idBot = decodeJid(zk.user.id);
            var servBot = idBot.split('@')[0];

            const verifGroupe = origineMessage?.endsWith("@g.us");

            // FIX 3: Use cached getGroupMetadata instead of direct API call every message
            var infosGroupe = verifGroupe ? await getGroupMetadata(zk, origineMessage) : "";
            var nomGroupe = verifGroupe ? infosGroupe?.subject : "";

            var msgRepondu = ms.message.extendedTextMessage?.contextInfo?.quotedMessage;
            var auteurMsgRepondu = decodeJid(ms.message?.extendedTextMessage?.contextInfo?.participant);

            // FIX 4: was ms.Message (capital M) — always returned undefined
            var mr = ms.message?.extendedTextMessage?.contextInfo?.mentionedJid;
            var utilisateur = mr ? mr : msgRepondu ? auteurMsgRepondu : "";

            var auteurMessage = verifGroupe ? (ms.key.participant ? ms.key.participant : ms.participant) : origineMessage;
            if (ms.key.fromMe) {
                auteurMessage = idBot;
            }

            var membreGroupe = verifGroupe ? ms.key.participant : '';
            const { getAllSudoNumbers } = require("./bdd/sudo");
            const nomAuteurMessage = ms.pushName;

            // Dev/owner numbers
            const dj = '255784766591';
            const sudo = await getAllSudoNumbers();

            // FIX 5: replace(/[^0-9]/g) was missing the replacement string '' — caused NaN/undefined
            const superUserNumbers = [servBot, dj, conf.NUMERO_OWNER].map((s) => s.replace(/[^0-9]/g, '') + "@s.whatsapp.net");
            const allAllowedNumbers = superUserNumbers.concat(sudo);
            const superUser = allAllowedNumbers.includes(auteurMessage);
            var dev = [dj].map((t) => t.replace(/[^0-9]/g, '') + "@s.whatsapp.net").includes(auteurMessage);

            function repondre(mes) { zk.sendMessage(origineMessage, { text: mes }, { quoted: ms }); }

            console.log("\nÄŖŸÄŅ-ȚËĊȞ is ONLINE");
            console.log("=========== written message ===========");
            if (verifGroupe) console.log("groupe : " + nomGroupe);
            console.log("sender : [" + nomAuteurMessage + " : " + auteurMessage.split("@s.whatsapp.net")[0] + "]");
            console.log("type : " + mtype);
            // FIX 6: Removed duplicate console.log(texte) — was printed twice before
            console.log("------ message content ------");
            console.log(texte);

            // ============================================================
            // CHATBOT (AUTO-REPLY & AUDIO)
            // ============================================================
            if (conf.CHATBOT === "on" && !ms.key.fromMe) {
                const query = texte ? texte.toLowerCase().trim() : "";
                const senderJid = ms.key.participant || ms.key.remoteJid;
                const senderTag = `@${senderJid.split('@')[0]}`;

                const textTriggers = [
                    "hi", "hello", "mambo", "niaje", "habari", "mambo vipi", "shwari", "oy", "oiee",
                    "mambo?", "poa", "safi", "mzima", "hujambo", "habari yako", "mshkaji", "vipi",
                    "mambo yanakuwaje", "uko sawa", "niambie", "semo", "bro", "kiongozi", "admin",
                    "bot", "timnasa", "mambo bot", "ujumbe", "nisaidie", "msaada", "karibu", "asanteni",
                    "thanks", "thank you", "asante", "shukrani", "pamoja", "tuko pamoja", "uko wapi",
                    "uko online", "mbona kimya", "nicheki", "nipigie", "unajua nini", "mimi hapa",
                    "nani yuko hapo", "upo?", "habari za mchana", "habari za asubuhi", "habari za jioni"
                ];

                if (query && textTriggers.includes(query)) {
                    let responses = [
                        `Safi sana ${senderTag}, mzima? Karibu! 🤖`,
                        `kaka ${senderTag}! Unahitaji nini kiongozi?`,
                        `Salama kabisa ${senderTag}, natumai u mzima wa afya.`,
                        `Karibu sana ${senderTag}, furaha yangu ni kukusaidia! 🙏`,
                        `mkuu ${senderTag}, sema lolote nipo kwa ajili yako.`
                    ];
                    let randomResponse = responses[Math.floor(Math.random() * responses.length)];
                    await zk.sendPresenceUpdate('composing', origineMessage);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await zk.sendMessage(origineMessage, { text: randomResponse, mentions: [senderJid] }, { quoted: ms });
                }

                const audioTriggers = [
                    "cheka", "hahaha", "haha", "😂", "🤣", "vichekesho", "niambie kitu", "nichekeshe",
                    "sound", "sauti", "audio", "nitumie", "oyee", "oyee!", "shangilia", "shangwe",
                    "piga kelele", "fanya vurugu", "vurugu", "sherehe", "happy", "furaha", "cheza",
                    "ngoma", "mziki", "hit", "fire", "moto", "🔥🔥", "balaa", "noma", "hatari",
                    "fungua", "sikiliza", "test", "jaribu", "fanya", "anza", "piga", "rekodi",
                    "sauti gani", "nini hii", "sikia", "mambo gani", "mambo vipi sauti", "mzuka",
                    "amsha", "amsha amsha", "changamka", "changamsha", "timoth"
                ];

                if (query && audioTriggers.includes(query)) {
                    const audioUrl = "https://files.catbox.moe/de6scq.MP3";
                    await zk.sendPresenceUpdate('recording', origineMessage);
                    await new Promise(resolve => setTimeout(resolve, 3500));
                    await zk.sendMessage(origineMessage, {
                        audio: { url: audioUrl },
                        mimetype: 'audio/mp4',
                        ptt: true
                    }, { quoted: ms });
                }
            }

            // ============================================================
            // ANTI-DELETE (messages.update listener — registered once here)
            // ============================================================
            // NOTE: This listener is intentionally inside messages.upsert to share
            // scope with store. It self-checks conf.ANTIDELETE each time.
            zk.ev.on('messages.update', async (chatUpdate) => {
                for (const { key, update } of chatUpdate) {
                    if (update.protocolMessage && update.protocolMessage.type === 0) {
                        if (conf.ANTIDELETE !== "yes") return;
                        try {
                            const oldMsg = await store.loadMessage(key.remoteJid, update.protocolMessage.key.id);
                            if (!oldMsg) return;
                            const myNumber = zk.user.id.split(':')[0] + '@s.whatsapp.net';
                            const sender = update.protocolMessage.key.participant || update.protocolMessage.key.remoteJid;
                            const isGroup = key.remoteJid.endsWith('@g.us');
                            const destination = (conf.ANTIDELETE_DEST === "group") ? key.remoteJid : myNumber;

                            let report = `*🚨 ÄŖŸÄŅȚËĊȞ ANTI-DELETE DETECTED 🚨*\n\n`;
                            report += `👤 *Sender:* @${sender.split('@')[0]}\n`;
                            report += `📍 *Location:* ${isGroup ? "Group Chat" : "Private Chat"}\n`;
                            if (isGroup) {
                                const metadata = await getGroupMetadata(zk, key.remoteJid);
                                if (metadata) report += `🏘️ *Group Name:* ${metadata.subject}\n`;
                            }
                            report += `📅 *Time:* ${new Date().toLocaleString()}\n\n`;
                            report += `⚠️ *Restored Content below:*`;
                            await zk.sendMessage(destination, { text: report, mentions: [sender] });
                            await zk.copyNForward(destination, oldMsg, true);
                        } catch (err) {
                            console.log("Anti-delete Error: " + err);
                        }
                    }
                }
            });

            // ============================================================
            // STATUS MENTIONS PROTECTION
            // FIX 7: Merged STATUS_MENTIONS and ANTISTATUS into one block
            // to prevent user being kicked twice for same action
            // ============================================================
            if ((conf.STATUS_MENTIONS === "on" || conf.ANTISTATUS === "on") && ms.message && !ms.key.fromMe) {
                const isGroup = origineMessage.endsWith('@g.us');
                const contextInfo = ms.message?.extendedTextMessage?.contextInfo
                    || ms.message?.imageMessage?.contextInfo
                    || ms.message?.videoMessage?.contextInfo;
                const hasMentions = contextInfo?.mentionedJid?.length > 0;
                const isStatusType = ms.message?.statusMentionMessage || ms.message?.protocolMessage?.type === 3;

                if (isGroup && (isStatusType || hasMentions)) {
                    const botNumber = zk.user.id.split(':')[0] + '@s.whatsapp.net';
                    const groupMeta = await getGroupMetadata(zk, origineMessage);
                    if (groupMeta) {
                        const groupAdmins = groupMeta.participants.filter(v => v.admin !== null).map(v => v.id);
                        const isBotAdmin = groupAdmins.includes(botNumber);
                        const isSenderAdmin = groupAdmins.includes(ms.key.participant);

                        if (isBotAdmin && !isSenderAdmin) {
                            await zk.sendMessage(origineMessage, { delete: ms.key });
                            await zk.sendMessage(origineMessage, {
                                text: `🚫 *ANTI-TAG SYSTEM* 🚫\n\n@${ms.key.participant.split('@')[0]} detected using hidden mentions.\n\n*Action:* Message Deleted & User Removed.`,
                                mentions: [ms.key.participant]
                            });
                            setTimeout(async () => {
                                await zk.groupParticipantsUpdate(origineMessage, [ms.key.participant], "remove");
                            }, 2000);
                        }
                    }
                }
            }

            // ============================================================
            // ANTI-STICKER
            // ============================================================
            if (conf.ANTISTICKER === "on" && ms.message?.stickerMessage && !ms.key.fromMe) {
                const isGroup = origineMessage.endsWith('@g.us');
                if (isGroup) {
                    const botNumber = zk.user.id.split(':')[0] + '@s.whatsapp.net';
                    const groupMeta = await getGroupMetadata(zk, origineMessage);
                    if (groupMeta) {
                        const groupAdmins = groupMeta.participants.filter(v => v.admin !== null).map(v => v.id);
                        const isBotAdmin = groupAdmins.includes(botNumber);
                        const isSenderAdmin = groupAdmins.includes(ms.key.participant);
                        if (isBotAdmin && !isSenderAdmin) {
                            await zk.sendMessage(origineMessage, { delete: ms.key });
                            await zk.sendMessage(origineMessage, {
                                text: `⚠️ *ANTI-STICKER SYSTEM* ⚠️\n\n@${ms.key.participant.split('@')[0]}, stickers are prohibited in this group.\n\n*Action:* Message Deleted.`,
                                mentions: [ms.key.participant]
                            });
                        }
                    }
                }
            }

            // ============================================================
            // ADMIN HELPERS & COMMAND OPTIONS
            // ============================================================
            function groupeAdmin(membres) {
                let admin = [];
                for (let m of membres) {
                    if (m.admin == null) continue;
                    admin.push(m.id);
                }
                return admin;
            }

            // Presence update based on ETAT config
            var etat = conf.ETAT;
            if (etat == 1) await zk.sendPresenceUpdate("available", origineMessage);
            else if (etat == 2) await zk.sendPresenceUpdate("composing", origineMessage);
            else if (etat == 3) await zk.sendPresenceUpdate("recording", origineMessage);
            else await zk.sendPresenceUpdate("unavailable", origineMessage);

            const mbre = verifGroupe ? infosGroupe?.participants : '';
            let admins = verifGroupe ? groupeAdmin(mbre) : '';
            const verifAdmin = verifGroupe ? admins.includes(auteurMessage) : false;
            var verifZokouAdmin = verifGroupe ? admins.includes(idBot) : false;

            const arg = texte ? texte.trim().split(/ +/).slice(1) : null;
            const verifCom = texte ? texte.startsWith(prefixe) : false;
            const com = verifCom ? texte.slice(1).trim().split(/ +/).shift().toLowerCase() : false;

            const lien = conf.URL ? conf.URL.split(',') : [];
            function mybotpic() {
                if (!lien.length) return '';
                return lien[Math.floor(Math.random() * lien.length)];
            }

            var commandeOptions = {
                superUser, dev,
                verifGroupe,
                mbre,
                membreGroupe,
                verifAdmin,
                infosGroupe,
                nomGroupe,
                auteurMessage,
                nomAuteurMessage,
                idBot,
                verifZokouAdmin,
                prefixe,
                arg,
                repondre,
                mtype,
                groupeAdmin,
                msgRepondu,
                auteurMsgRepondu,
                ms,
                mybotpic
            };

            // ============================================================
            // OLD-STYLE ANTI-DELETE (store.json fallback)
            // ============================================================
            if (ms.message.protocolMessage && ms.message.protocolMessage.type === 0 && (conf.ADM || '').toLocaleLowerCase() === 'yes') {
                if (ms.key.fromMe || ms.message.protocolMessage.key.fromMe) { console.log('Message supprimer me concernant'); return; }
                console.log('Message supprimer');
                let key = ms.message.protocolMessage.key;
                try {
                    let st = './store.json';
                    if (fs.existsSync(st)) {
                        const data = fs.readFileSync(st, 'utf8');
                        const jsonData = JSON.parse(data);
                        let message = jsonData.messages[key.remoteJid];
                        let msg;
                        for (let i = 0; i < message.length; i++) {
                            if (message[i].key.id === key.id) { msg = message[i]; break; }
                        }
                        if (!msg) { console.log('Message non trouver'); return; }
                        await zk.sendMessage(idBot, {
                            image: { url: './media/deleted-message.jpg' },
                            caption: `😎Anti-delete-message🥵\nMessage from @${msg.key.participant.split('@')[0]}`,
                            mentions: [msg.key.participant]
                        });
                        zk.sendMessage(idBot, { forward: msg }, { quoted: msg });
                    }
                } catch (e) { console.log(e); }
            }

            // ============================================================
            // AUTO READ & DOWNLOAD STATUS
            // ============================================================
            if (ms.key && ms.key.remoteJid === "status@broadcast" && conf.AUTO_READ_STATUS === "yes") {
                await zk.readMessages([ms.key]);
            }
            if (ms.key && ms.key.remoteJid === 'status@broadcast' && conf.AUTO_DOWNLOAD_STATUS === "yes") {
                if (ms.message.extendedTextMessage) {
                    await zk.sendMessage(idBot, { text: ms.message.extendedTextMessage.text }, { quoted: ms });
                } else if (ms.message.imageMessage) {
                    var stImg = await zk.downloadAndSaveMediaMessage(ms.message.imageMessage);
                    await zk.sendMessage(idBot, { image: { url: stImg }, caption: ms.message.imageMessage.caption || '' }, { quoted: ms });
                } else if (ms.message.videoMessage) {
                    var stVideo = await zk.downloadAndSaveMediaMessage(ms.message.videoMessage);
                    await zk.sendMessage(idBot, { video: { url: stVideo }, caption: ms.message.videoMessage.caption || '' }, { quoted: ms });
                }
            }

            if (!dev && origineMessage == "120363158701337904@g.us") return;

            // ============================================================
            // XP / LEVEL SYSTEM
            // ============================================================
            if (texte && auteurMessage.endsWith("s.whatsapp.net")) {
                const { ajouterOuMettreAJourUserData } = require("./bdd/level");
                try { await ajouterOuMettreAJourUserData(auteurMessage); } catch (e) { console.error(e); }
            }

            // ============================================================
            // MENTION RESPONSE (when bot or owner is tagged)
            // ============================================================
            try {
                const mentionedJids = ms.message[mtype]?.contextInfo?.mentionedJid;
                if (mentionedJids && (mentionedJids.includes(idBot) || mentionedJids.includes(conf.NUMERO_OWNER + '@s.whatsapp.net'))) {
                    if (origineMessage == "120363158701337904@g.us") return;
                    if (superUser) { console.log('superuser mention ignored'); return; }
                    let mbd = require('./bdd/mention');
                    let alldata = await mbd.recupererToutesLesValeurs();
                    let data = alldata[0];
                    if (!data || data.status === 'non') { console.log('mention not active'); return; }
                    let msg;
                    if (data.type.toLocaleLowerCase() === 'image') {
                        msg = { image: { url: data.url }, caption: data.message };
                    } else if (data.type.toLocaleLowerCase() === 'video') {
                        msg = { video: { url: data.url }, caption: data.message };
                    } else if (data.type.toLocaleLowerCase() === 'sticker') {
                        let stickerMess = new Sticker(data.url, {
                            pack: conf.NOM_OWNER,
                            type: StickerTypes.FULL,
                            categories: ["🤩", "🎉"],
                            id: "12345",
                            quality: 70,
                            background: "transparent",
                        });
                        const stickerBuffer2 = await stickerMess.toBuffer();
                        msg = { sticker: stickerBuffer2 };
                    } else if (data.type.toLocaleLowerCase() === 'audio') {
                        msg = { audio: { url: data.url }, mimetype: 'audio/mp4' };
                    }
                    if (msg) zk.sendMessage(origineMessage, msg, { quoted: ms });
                }
            } catch (error) { /* Silently ignore — contextInfo may not exist */ }

            // ============================================================
            // ANTI-LINK (3-STRIKE RULE)
            // ============================================================
            try {
                const antilinkActive = await verifierEtatJid(origineMessage);
                if (texte && texte.includes('https://') && verifGroupe && antilinkActive) {
                    console.log("🔗 Anti-link activated - link detected");
                    var verifZokAdmin = verifGroupe ? admins.includes(idBot) : false;
                    if (superUser || verifAdmin || !verifZokAdmin) {
                        console.log('Anti-link: ignoring (superUser/admin or bot not admin)');
                    } else {
                        const linkKey = {
                            remoteJid: origineMessage,
                            fromMe: false,
                            id: ms.key.id,
                            participant: auteurMessage
                        };
                        var txt = "lien detected,\n";
                        const gifLink = "https://raw.githubusercontent.com/Next5x/ARYAN-TECH/main/media/remover.gif";
                        var sticker = new Sticker(gifLink, {
                            pack: 'aryan md',
                            author: conf.OWNER_NAME,
                            type: StickerTypes.FULL,
                            categories: ['🤩', '🎉'],
                            id: '12345',
                            quality: 50,
                            background: '#000000'
                        });
                        await sticker.toFile("st1.webp");
                        var action = await recupererActionJid(origineMessage);

                        if (action === 'remove') {
                            txt += `message deleted\n@${auteurMessage.split("@")[0]} removed from group.`;
                            if (fs.existsSync("st1.webp")) await zk.sendMessage(origineMessage, { sticker: fs.readFileSync("st1.webp") });
                            await (0, baileys_1.delay)(800);
                            await zk.sendMessage(origineMessage, { text: txt, mentions: [auteurMessage] }, { quoted: ms });
                            try { await zk.groupParticipantsUpdate(origineMessage, [auteurMessage], "remove"); } catch (e) { console.log("anti-link remove error:", e); }
                            await zk.sendMessage(origineMessage, { delete: linkKey });
                            if (fs.existsSync("st1.webp")) await fs.unlink("st1.webp");
                        } else if (action === 'delete') {
                            txt += `message deleted\n@${auteurMessage.split("@")[0]} avoid sending links.`;
                            if (fs.existsSync("st1.webp")) await zk.sendMessage(origineMessage, { sticker: fs.readFileSync("st1.webp") });
                            await (0, baileys_1.delay)(800);
                            await zk.sendMessage(origineMessage, { text: txt, mentions: [auteurMessage] }, { quoted: ms });
                            await zk.sendMessage(origineMessage, { delete: linkKey });
                            if (fs.existsSync("st1.webp")) await fs.unlink("st1.webp");
                        } else if (action === 'warn') {
                            let warn = await getWarnCountByJID(auteurMessage) || 0;
                            let warnlimit = conf.WARN_COUNT || 3;
                            if (warn >= warnlimit) {
                                var kikmsg = `🔗 Link detected! @${auteurMessage.split("@")[0]} removed for sending links ${warnlimit} times.`;
                                if (fs.existsSync("st1.webp")) await zk.sendMessage(origineMessage, { sticker: fs.readFileSync("st1.webp") });
                                await (0, baileys_1.delay)(800);
                                await zk.sendMessage(origineMessage, { text: kikmsg, mentions: [auteurMessage] }, { quoted: ms });
                                await zk.groupParticipantsUpdate(origineMessage, [auteurMessage], "remove");
                                await resetWarnCountByJID(auteurMessage);
                            } else {
                                await ajouterUtilisateurAvecWarnCount(auteurMessage);
                                var rest = warnlimit - (warn + 1);
                                var warnMsg = `🔗 *LINK DETECTED!* ⚠️\n\n@${auteurMessage.split("@")[0]} warning ${warn + 1}/${warnlimit}\nRemaining: ${rest}\n\n_Removed after ${rest} more link(s)._`;
                                if (fs.existsSync("st1.webp")) await zk.sendMessage(origineMessage, { sticker: fs.readFileSync("st1.webp") });
                                await (0, baileys_1.delay)(800);
                                await zk.sendMessage(origineMessage, { text: warnMsg, mentions: [auteurMessage] }, { quoted: ms });
                            }
                            await zk.sendMessage(origineMessage, { delete: linkKey });
                            if (fs.existsSync("st1.webp")) await fs.unlink("st1.webp");
                        }
                    }
                }
            } catch (e) {
                console.log("Anti-link error:", e);
            }

            // ============================================================
            // ANTI-BOT DETECTION
            // ============================================================
            try {
                const botMsg = ms.key?.id?.startsWith('BAES') && ms.key?.id?.length === 16;
                const baileysMsg = ms.key?.id?.startsWith('BAE5') && ms.key?.id?.length === 16;
                if (botMsg || baileysMsg) {
                    if (mtype === 'reactionMessage') { console.log('Ignoring reaction'); return; }
                    const antibotactiver = await atbverifierEtatJid(origineMessage);
                    if (!antibotactiver) return;
                    if (verifAdmin || auteurMessage === idBot) { console.log('Bot/admin — ignoring antibot'); return; }

                    const botKey = {
                        remoteJid: origineMessage,
                        fromMe: false,
                        id: ms.key.id,
                        participant: auteurMessage
                    };
                    var botTxt = "bot detected,\n";
                    const botGifLink = "https://raw.githubusercontent.com/Next5x/ARYAN-TECH/main/media/remover.gif";
                    var botSticker = new Sticker(botGifLink, {
                        pack: 'aryan md',
                        author: conf.OWNER_NAME,
                        type: StickerTypes.FULL,
                        categories: ['🤩', '🎉'],
                        id: '12345',
                        quality: 50,
                        background: '#000000'
                    });
                    await botSticker.toFile("st1.webp");
                    var botAction = await atbrecupererActionJid(origineMessage);

                    if (botAction === 'remove') {
                        botTxt += `message deleted\n@${auteurMessage.split("@")[0]} removed from group.`;
                        if (fs.existsSync("st1.webp")) await zk.sendMessage(origineMessage, { sticker: fs.readFileSync("st1.webp") });
                        await (0, baileys_1.delay)(800);
                        await zk.sendMessage(origineMessage, { text: botTxt, mentions: [auteurMessage] }, { quoted: ms });
                        try { await zk.groupParticipantsUpdate(origineMessage, [auteurMessage], "remove"); } catch (e) { console.log("antibot remove error:", e); }
                        await zk.sendMessage(origineMessage, { delete: botKey });
                        if (fs.existsSync("st1.webp")) await fs.unlink("st1.webp");
                    } else if (botAction === 'delete') {
                        botTxt += `message deleted\n@${auteurMessage.split("@")[0]} avoid bot messages.`;
                        await zk.sendMessage(origineMessage, { text: botTxt, mentions: [auteurMessage] }, { quoted: ms });
                        await zk.sendMessage(origineMessage, { delete: botKey });
                        if (fs.existsSync("st1.webp")) await fs.unlink("st1.webp");
                    } else if (botAction === 'warn') {
                        let warn = await getWarnCountByJID(auteurMessage) || 0;
                        let warnlimit = conf.WARN_COUNT || 3;
                        if (warn >= warnlimit) {
                            var kickmsg = `bot detected — removed for reaching warn limit.`;
                            await zk.sendMessage(origineMessage, { text: kickmsg, mentions: [auteurMessage] }, { quoted: ms });
                            await zk.groupParticipantsUpdate(origineMessage, [auteurMessage], "remove");
                            await resetWarnCountByJID(auteurMessage);
                            await zk.sendMessage(origineMessage, { delete: botKey });
                        } else {
                            await ajouterUtilisateurAvecWarnCount(auteurMessage);
                            var rest = warnlimit - (warn + 1);
                            var warnBotMsg = `bot detected, warn count upgraded.\nRemaining: ${rest}`;
                            await zk.sendMessage(origineMessage, { text: warnBotMsg, mentions: [auteurMessage] }, { quoted: ms });
                            await zk.sendMessage(origineMessage, { delete: botKey });
                        }
                        if (fs.existsSync("st1.webp")) await fs.unlink("st1.webp");
                    }
                }
            } catch (er) {
                console.log('antibot error: ' + er);
            }

            // ============================================================
            // COMMAND DISPATCHER
            // ============================================================
            if (verifCom) {
                // FIX 8: Also check aliases for command matching
                const cd = evt.cm.find((zokou) => zokou.nomCom === com || (zokou.aliases && zokou.aliases.includes(com)));
                if (cd) {
                    try {
                        if ((conf.MODE).toLocaleLowerCase() != 'yes' && !superUser) return;
                        if (!superUser && origineMessage === auteurMessage && conf.PM_PERMIT === "yes") {
                            repondre("You don't have access to commands here"); return;
                        }
                        if (!superUser && verifGroupe) {
                            let req = await isGroupBanned(origineMessage);
                            if (req) return;
                        }
                        if (!verifAdmin && verifGroupe) {
                            let req = await isGroupOnlyAdmin(origineMessage);
                            if (req) return;
                        }
                        if (!superUser) {
                            let req = await isUserBanned(auteurMessage);
                            if (req) { repondre("You are banned from bot commands"); return; }
                        }
                        reagir(origineMessage, zk, ms, cd.reaction);
                        cd.fonction(origineMessage, zk, commandeOptions);
                    } catch (e) {
                        console.log("😡 Command error: " + e);
                        zk.sendMessage(origineMessage, { text: "😡 " + e }, { quoted: ms });
                    }
                }
            }
        });

        // ============================================================
        // GROUP PARTICIPANTS: WELCOME / GOODBYE / ANTI-PROMOTE
        // ============================================================
        const { recupevents } = require('./bdd/welcome');

        zk.ev.on('group-participants.update', async (group) => {
            try {
                const metadata = await getGroupMetadata(zk, group.id);
                if (!metadata) return;
                let membres = group.participants;

                for (let membre of membres) {
                    let ppuser;
                    try {
                        ppuser = await zk.profilePictureUrl(membre, 'image');
                    } catch {
                        try {
                            ppuser = await zk.profilePictureUrl(group.id, 'image');
                        } catch {
                            ppuser = 'https://telegra.ph/file/default-profile-pic.jpg';
                        }
                    }

                    if (group.action == 'add' && (await recupevents(group.id, "welcome") == 'on')) {
                        let msg = `*ÄŖŸÄŅ-ȚËĊȞ. 𝐖𝐄𝐋𝐂𝐎𝐌𝐄 𝐈𝐍 𝐓𝐇𝐄 𝐆𝐑𝐎𝐔𝐏*\n\n🖐️ @${membre.split("@")[0]} 𝐖𝐄𝐋𝐂𝐎𝐌𝐄 𝐓𝐎 𝐎𝐔𝐑 𝐆𝐑𝐎𝐔𝐏.\n\n❒ *𝑅𝐸𝐴𝐷 𝑇𝐻𝐸 𝐺𝑅𝑂𝑈𝑃 𝐷𝐸𝑆𝐶𝑅𝐼𝑃𝑇𝐼𝑂𝑁 𝑇𝑂 𝐴𝑉𝑂𝐼𝐷 𝐺𝐸𝑇𝑇𝐼𝑁𝐺 𝑅𝐸𝑀𝑂𝑉𝐸𝐷 🫩*`;
                        await zk.sendMessage(group.id, { image: { url: ppuser }, caption: msg, mentions: [membre] });
                    } else if (group.action == 'remove' && (await recupevents(group.id, "goodbye") == 'on')) {
                        let msg = `𝐌𝐄𝐌𝐁𝐄𝐑 𝐋𝐄𝐅𝐓 𝐆𝐑𝐎𝐔𝐏 🥲\n@${membre.split("@")[0]}`;
                        await zk.sendMessage(group.id, { image: { url: ppuser }, caption: msg, mentions: [membre] });
                    }
                }

                if (group.action == 'promote' && (await recupevents(group.id, "antipromote") == 'on')) {
                    const decodeJidLocal = (jid) => {
                        if (!jid) return jid;
                        if (/:\d+@/gi.test(jid)) {
                            let decode = (0, baileys_1.jidDecode)(jid) || {};
                            return decode.user && decode.server ? decode.user + '@' + decode.server : jid;
                        }
                        return jid;
                    };
                    if (group.author == metadata.owner || group.author == conf.NUMERO_OWNER + '@s.whatsapp.net' || group.author == decodeJidLocal(zk.user.id) || group.author == group.participants[0]) return;
                    await zk.groupParticipantsUpdate(group.id, [group.author, group.participants[0]], "demote");
                    zk.sendMessage(group.id, { text: `@${(group.author).split("@")[0]} violated anti-promotion rule.`, mentions: [group.author, group.participants[0]] });
                }
            } catch (e) {
                console.error("Error in group-participants.update:", e);
            }
        });

        // ============================================================
        // SCHEDULED CRONS (group mute/unmute)
        // ============================================================
        async function activateCrons() {
            const cron = require('node-cron');
            const { getCron } = require('./bdd/cron');
            let crons = await getCron();
            if (crons.length > 0) {
                for (let i = 0; i < crons.length; i++) {
                    if (crons[i].mute_at != null) {
                        let set = crons[i].mute_at.split(':');
                        cron.schedule(`${set[1]} ${set[0]} * * *`, async () => {
                            await zk.groupSettingUpdate(crons[i].group_id, 'announcement');
                            zk.sendMessage(crons[i].group_id, { image: { url: './media/chrono.webp' }, caption: "Group Closed." });
                        }, { timezone: "Africa/Nairobi" });
                    }
                }
            }
        }

        // ============================================================
        // CONTACTS UPSERT
        // ============================================================
        zk.ev.on("contacts.upsert", async (contacts) => {
            for (const contact of contacts) {
                if (store.contacts[contact.id]) {
                    Object.assign(store.contacts[contact.id], contact);
                } else {
                    store.contacts[contact.id] = contact;
                }
            }
        });

        // ============================================================
        // CONNECTION UPDATE
        // ============================================================
        zk.ev.on("connection.update", async (con) => {
            const { lastDisconnect, connection } = con;
            if (connection === "connecting") {
                console.log("ℹ️ ÄŖŸÄŅ-ȚËĊȞ is connecting...");
            } else if (connection === 'open') {
                console.log("🔮 ÄŖŸÄŅ-ȚËĊȞ Connected to WhatsApp! 🫧");
                console.log("🛒 Loading Plugins...\n");

                fs.readdirSync(__dirname + "/commandes").forEach((fichier) => {
                    if (path.extname(fichier).toLowerCase() == ".js") {
                        try {
                            require(__dirname + "/commandes/" + fichier);
                            console.log(fichier + " ✔️ Loaded");
                        } catch (e) {
                            console.log(`${fichier} failed to load: ${e}`);
                        }
                        (0, baileys_1.delay)(300);
                    }
                });

                (0, baileys_1.delay)(700);
                console.log("🏆 Plugins Loaded ✅");

                // Auto-follow channel
                try {
                    const myChannelJid = "120363420172397674@newsletter";
                    await zk.newsletterFollow(myChannelJid);
                    console.log("✅ Channel followed!");
                } catch (e) {
                    console.log("Newsletter follow error: " + e);
                }

                await activateCrons();

                if ((conf.DP || '').toLowerCase() === 'yes') {
                    let cmsg = `ᴍᴀᴅᴇ ғʀᴏᴍ ᴛᴀɴᴢᴀɴɪᴀ 🇹🇿\n╭─────────────━┈⊷•\n│●│ *ᯤ ÄŖŸÄŅ-ȚËĊȞ: ᴄᴏɴɴᴇᴄᴛᴇᴅ*\n│¤│ᴘʀᴇғɪx: *[ ${prefixe} ]*\n│○│ᴍᴏᴅᴇ: *${(conf.MODE || '').toLowerCase() === "yes" ? "public" : "private"}*\n╰─────────────━┈⊷•`;
                    await zk.sendMessage(zk.user.id, { text: cmsg });
                }
            } else if (connection == "close") {
                let raisonDeconnexion = new boom_1.Boom(lastDisconnect?.error)?.output.statusCode;
                if (raisonDeconnexion === baileys_1.DisconnectReason.badSession) {
                    console.log('Bad session — rescan again.');
                } else if (raisonDeconnexion === baileys_1.DisconnectReason.connectionClosed) {
                    console.log('Connection closed, reconnecting...'); setTimeout(main, 5000);
                } else if (raisonDeconnexion === baileys_1.DisconnectReason.connectionLost) {
                    console.log('Connection lost, reconnecting...'); setTimeout(main, 5000);
                } else if (raisonDeconnexion === baileys_1.DisconnectReason.restartRequired) {
                    console.log('Restart required...'); setTimeout(main, 5000);
                } else {
                    console.log('Restarting due to error:', raisonDeconnexion); setTimeout(main, 5000);
                }
            }
        });

        zk.ev.on("creds.update", saveCreds);

        // ============================================================
        // MEDIA DOWNLOAD HELPER
        // ============================================================
        zk.downloadAndSaveMediaMessage = async (message, filename = '', attachExtension = true) => {
            let quoted = message.msg ? message.msg : message;
            let mime = (message.msg || message).mimetype || '';
            let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
            const stream = await (0, baileys_1.downloadContentFromMessage)(quoted, messageType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            let type = await FileType.fromBuffer(buffer);
            let trueFileName = './' + filename + (attachExtension ? '.' + type.ext : '');
            await fs.writeFile(trueFileName, buffer);
            return trueFileName;
        };

        return zk;
    }

    main();
}, 5000);
