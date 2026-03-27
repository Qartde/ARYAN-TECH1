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
var __importStar = (this && this.__importStar) || function(mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function(mod) {
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
const { Sticker, createSticker, StickerTypes } = require('wa-sticker-formatter');
const { verifierEtatJid, recupererActionJid, mettreAJourActionJid, enregistrerJid, supprimerJid } = require("./bdd/antilien");
const { atbverifierEtatJid, atbrecupererActionJid } = require("./bdd/antibot");
let evt = require(__dirname + "/framework/zokou");
const { isUserBanned, addUserToBanList, removeUserFromBanList } = require("./bdd/banUser");
const { addGroupToBanList, isGroupBanned, removeGroupFromBanList } = require("./bdd/banGroup");
const { isGroupOnlyAdmin, addGroupToOnlyAdminList, removeGroupFromOnlyAdminList } = require("./bdd/onlyAdmin");
const { getWarnCountByJID, ajouterUtilisateurAvecWarnCount, resetWarnCountByJID } = require("./bdd/warn");
let { reagir } = require(__dirname + "/framework/app");
var session = conf.session.replace(/TIMNASA-MD;;;=>/g, "");
const prefixe = conf.PREFIXE;
const more = String.fromCharCode(8206);
const readmore = more.repeat(4001);

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

const groupMetadataCache = {};
const GROUP_CACHE_TTL = 5 * 60 * 1000;

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
        const { version, isLatest } = await (0, baileys_1.fetchLatestBaileysVersion)();
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
                    return msg.message || undefined;
                }
                return {
                    conversation: 'An Error Occurred, Repeat Command!'
                };
            }
        };
        const zk = (0, baileys_1.default)(sockOptions);
        store.bind(zk.ev);

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
                                react: {
                                    text: randomEmoji,
                                    key: message.key
                                }
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

        zk.ev.on("messages.upsert", async (m) => {
            const { messages } = m;
            const ms = messages[0];
            if (!ms.message) return;

            const decodeJid = (jid) => {
                if (!jid) return jid;
                if (/:\d+@/gi.test(jid)) {
                    let decode = (0, baileys_1.jidDecode)(jid) || {};
                    return decode.user && decode.server && decode.user + '@' + decode.server || jid;
                } else return jid;
            };

            var mtype = (0, baileys_1.getContentType)(ms.message);
            var texte = mtype == "conversation" ? ms.message.conversation :
                mtype == "imageMessage" ? ms.message.imageMessage?.caption :
                mtype == "videoMessage" ? ms.message.videoMessage?.caption :
                mtype == "extendedTextMessage" ? ms.message?.extendedTextMessage?.text :
                mtype == "buttonsResponseMessage" ? ms?.message?.buttonsResponseMessage?.selectedButtonId :
                mtype == "listResponseMessage" ? ms.message?.listResponseMessage?.singleSelectReply?.selectedRowId :
                mtype == "messageContextInfo" ? (ms?.message?.buttonsResponseMessage?.selectedButtonId || ms.message?.listResponseMessage?.singleSelectReply?.selectedRowId || ms.text) : "";
            
            var origineMessage = ms.key.remoteJid;
            var idBot = decodeJid(zk.user.id);
            var servBot = idBot.split('@')[0];
            
            const verifGroupe = origineMessage?.endsWith("@g.us");
            var infosGroupe = verifGroupe ? await zk.groupMetadata(origineMessage) : "";
            var nomGroupe = verifGroupe ? infosGroupe.subject : "";
            var msgRepondu = ms.message.extendedTextMessage?.contextInfo?.quotedMessage;
            var auteurMsgRepondu = decodeJid(ms.message?.extendedTextMessage?.contextInfo?.participant);
            
            var mr = ms.Message?.extendedTextMessage?.contextInfo?.mentionedJid;
            var utilisateur = mr ? mr : msgRepondu ? auteurMsgRepondu : "";
            var auteurMessage = verifGroupe ? (ms.key.participant ? ms.key.participant : ms.participant) : origineMessage;
            if (ms.key.fromMe) {
                auteurMessage = idBot;
            }

            console.log("------ contenu du message ------");
            console.log(texte);

            var membreGroupe = verifGroupe ? ms.key.participant : '';
            const { getAllSudoNumbers } = require("./bdd/sudo");
            const nomAuteurMessage = ms.pushName;
            const dj = '255784766591';
            const dj2 = '255784766591';
            const dj3 = "255784766591";
            const luffy = '255784766591';
            const sudo = await getAllSudoNumbers();
            const superUserNumbers = [servBot, dj, dj2, dj3, luffy, conf.NUMERO_OWNER].map((s) => s.replace(/[^0-9]/g) + "@s.whatsapp.net");
            const allAllowedNumbers = superUserNumbers.concat(sudo);
            const superUser = allAllowedNumbers.includes(auteurMessage);
            
            var dev = [dj, dj2, dj3, luffy].map((t) => t.replace(/[^0-9]/g) + "@s.whatsapp.net").includes(auteurMessage);
            
            function repondre(mes) {
                zk.sendMessage(origineMessage, { text: mes }, { quoted: ms });
            }
            
            console.log("\nÄŖŸÄŅ-ȚËĊȞ2 is ONLINE");
            console.log("=========== written message===========");
            if (verifGroupe) {
                console.log("message provenant du groupe : " + nomGroupe);
            }
            console.log("message envoyé par : " + "[" + nomAuteurMessage + " : " + auteurMessage.split("@s.whatsapp.net")[0] + " ]");
            console.log("type de message : " + mtype);
            console.log("------ contenu du message ------");
            console.log(texte);

            // ================== CHATBOT ==================
            if (conf.CHATBOT === "on" && !ms.key.fromMe) {
                const query = texte.toLowerCase().trim();
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

                if (textTriggers.includes(query)) {
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

                if (audioTriggers.includes(query)) {
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

            // ================== ANTI-DELETE ==================
            const { getAntiDeleteSettings } = require("./bdd/antidelete");
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
                            let report = `*🚨 ANTI-DELETE DETECTED 🚨*\n\n`;
                            report += `👤 *Sender:* @${sender.split('@')[0]}\n`;
                            report += `📍 *Location:* ${isGroup ? "Group Chat" : "Private Chat"}\n`;
                            if (isGroup) {
                                const metadata = await zk.groupMetadata(key.remoteJid);
                                report += `🏘️ *Group Name:* ${metadata.subject}\n`;
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

            // ================== STATUS MENTIONS PROTECTION ==================
            if (conf.STATUS_MENTIONS === "on" && ms.message && !ms.key.fromMe) {
                const isGroup = origineMessage.endsWith('@g.us');
                const contextInfo = ms.message?.extendedTextMessage?.contextInfo ||
                    ms.message?.imageMessage?.contextInfo ||
                    ms.message?.videoMessage?.contextInfo;
                const hasHiddenMentions = contextInfo?.mentionedJid?.length > 0;
                const isStatusType = ms.message?.statusMentionMessage || ms.message?.protocolMessage?.type === 3;
                if (isGroup && (isStatusType || hasHiddenMentions)) {
                    const botNumber = zk.user.id.split(':')[0] + '@s.whatsapp.net';
                    const groupMetadata = await zk.groupMetadata(origineMessage);
                    const groupAdmins = groupMetadata.participants.filter(v => v.admin !== null).map(v => v.id);
                    const isBotAdmin = groupAdmins.includes(botNumber);
                    const isSenderAdmin = groupAdmins.includes(ms.key.participant);
                    if (isBotAdmin && !isSenderAdmin) {
                        await zk.sendMessage(origineMessage, { delete: ms.key });
                        await zk.sendMessage(origineMessage, {
                            text: `🚫 *SECURITY ALERT* 🚫\n\n@${ms.key.participant.split('@')[0]} has been kicked for using Hidden Mentions.`,
                            mentions: [ms.key.participant]
                        });
                        setTimeout(async () => {
                            await zk.groupParticipantsUpdate(origineMessage, [ms.key.participant], "remove");
                        }, 1500);
                    }
                }
            }

            // ================== ANTI-STICKER ==================
            if (conf.ANTISTICKER === "on" && ms.message?.stickerMessage && !ms.key.fromMe) {
                const isGroup = origineMessage.endsWith('@g.us');
                if (isGroup) {
                    const botNumber = zk.user.id.split(':')[0] + '@s.whatsapp.net';
                    const groupMetadata = await zk.groupMetadata(origineMessage);
                    const groupAdmins = groupMetadata.participants.filter(v => v.admin !== null).map(v => v.id);
                    const isBotAdmin = groupAdmins.includes(botNumber);
                    const isSenderAdmin = groupAdmins.includes(ms.key.participant);
                    if (isBotAdmin && !isSenderAdmin) {
                        await zk.sendMessage(origineMessage, { delete: ms.key });
                        await zk.sendMessage(origineMessage, {
                            text: `⚠️ *ANTI-STICKER* ⚠️\n\n@${ms.key.participant.split('@')[0]}, stickers are prohibited in this group.`,
                            mentions: [ms.key.participant]
                        });
                    }
                }
            }

            function groupeAdmin(membreGroupe) {
                let admin = [];
                for (let m of membreGroupe) {
                    if (m.admin == null) continue;
                    admin.push(m.id);
                }
                return admin;
            }

            var etat = conf.ETAT;
            if (etat == 1) {
                await zk.sendPresenceUpdate("available", origineMessage);
            } else if (etat == 2) {
                await zk.sendPresenceUpdate("composing", origineMessage);
            } else if (etat == 3) {
                await zk.sendPresenceUpdate("recording", origineMessage);
            } else {
                await zk.sendPresenceUpdate("unavailable", origineMessage);
            }

            const mbre = verifGroupe ? await infosGroupe.participants : '';
            let admins = verifGroupe ? groupeAdmin(mbre) : '';
            const verifAdmin = verifGroupe ? admins.includes(auteurMessage) : false;
            var verifZokouAdmin = verifGroupe ? admins.includes(idBot) : false;

            const arg = texte ? texte.trim().split(/ +/).slice(1) : null;
            const verifCom = texte ? texte.startsWith(prefixe) : false;
            const com = verifCom ? texte.slice(1).trim().split(/ +/).shift().toLowerCase() : false;

            const lien = conf.URL.split(',');

            function mybotpic() {
                const indiceAleatoire = Math.floor(Math.random() * lien.length);
                const lienAleatoire = lien[indiceAleatoire];
                return lienAleatoire;
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

            if (ms.message.protocolMessage && ms.message.protocolMessage.type === 0 && (conf.ADM).toLocaleLowerCase() === 'yes') {
                if (ms.key.fromMe || ms.message.protocolMessage.key.fromMe) {
                    console.log('Message supprimer me concernant');
                    return;
                }
                console.log(`Message supprimer`);
                let key = ms.message.protocolMessage.key;
                try {
                    let st = './store.json';
                    const data = fs.readFileSync(st, 'utf8');
                    const jsonData = JSON.parse(data);
                    let message = jsonData.messages[key.remoteJid];
                    let msg;
                    for (let i = 0; i < message.length; i++) {
                        if (message[i].key.id === key.id) {
                            msg = message[i];
                            break;
                        }
                    }
                    if (msg === null || !msg || msg === 'undefined') {
                        console.log('Message non trouver');
                        return;
                    }
                    await zk.sendMessage(idBot, { image: { url: './media/deleted-message.jpg' }, caption: `😎Anti-delete-message🥵\n Message from @${msg.key.participant.split('@')[0]}​`, mentions: [msg.key.participant] },)
                        .then(() => {
                            zk.sendMessage(idBot, { forward: msg }, { quoted: msg });
                        });
                } catch (e) {
                    console.log(e);
                }
            }

            if (ms.key && ms.key.remoteJid === "status@broadcast" && conf.AUTO_READ_STATUS === "yes") {
                await zk.readMessages([ms.key]);
            }
            if (ms.key && ms.key.remoteJid === 'status@broadcast' && conf.AUTO_DOWNLOAD_STATUS === "yes") {
                if (ms.message.extendedTextMessage) {
                    var stTxt = ms.message.extendedTextMessage.text;
                    await zk.sendMessage(idBot, { text: stTxt }, { quoted: ms });
                } else if (ms.message.imageMessage) {
                    var stMsg = ms.message.imageMessage.caption;
                    var stImg = await zk.downloadAndSaveMediaMessage(ms.message.imageMessage);
                    await zk.sendMessage(idBot, { image: { url: stImg }, caption: stMsg }, { quoted: ms });
                } else if (ms.message.videoMessage) {
                    var stMsg = ms.message.videoMessage.caption;
                    var stVideo = await zk.downloadAndSaveMediaMessage(ms.message.videoMessage);
                    await zk.sendMessage(idBot, {
                        video: { url: stVideo }, caption: stMsg
                    }, { quoted: ms });
                }
            }
            if (!dev && origineMessage == "120363158701337904@g.us") {
                return;
            }

            if (texte && auteurMessage.endsWith("s.whatsapp.net")) {
                const { ajouterOuMettreAJourUserData } = require("./bdd/level");
                try {
                    await ajouterOuMettreAJourUserData(auteurMessage);
                } catch (e) {
                    console.error(e);
                }
            }

            try {
                if (ms.message[mtype].contextInfo.mentionedJid && (ms.message[mtype].contextInfo.mentionedJid.includes(idBot) || ms.message[mtype].contextInfo.mentionedJid.includes(conf.NUMERO_OWNER + '@s.whatsapp.net'))) {
                    if (origineMessage == "120363158701337904@g.us") {
                        return;
                    };
                    if (superUser) {
                        console.log('hummm');
                        return;
                    }
                    let mbd = require('./bdd/mention');
                    let alldata = await mbd.recupererToutesLesValeurs();
                    let data = alldata[0];
                    if (data.status === 'non') {
                        console.log('mention pas actifs');
                        return;
                    }
                    let msg;
                    if (data.type.toLocaleLowerCase() === 'image') {
                        msg = {
                            image: { url: data.url },
                            caption: data.message
                        };
                    } else if (data.type.toLocaleLowerCase() === 'video') {
                        msg = {
                            video: { url: data.url },
                            caption: data.message
                        };
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
                        msg = {
                            sticker: stickerBuffer2
                        };
                    } else if (data.type.toLocaleLowerCase() === 'audio') {
                        msg = {
                            audio: { url: data.url },
                            mimetype: 'audio/mp4',
                        };
                    }
                    zk.sendMessage(origineMessage, msg, { quoted: ms });
                }
            } catch (error) {}

            // ============ COMMANDS ============
            if (verifCom) {
                const cd = evt.cm.find((zokou) => zokou.nomCom === (com));
                if (cd) {
                    try {
                        if ((conf.MODE).toLocaleLowerCase() != 'yes' && !superUser) {
                            repondre("Bot iko private mode!");
                            return;
                        }
                        if (!superUser && origineMessage === auteurMessage && conf.PM_PERMIT === "yes") {
                            repondre("You don't have access to commands here");
                            return;
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
                            if (req) {
                                repondre("You are banned from bot commands");
                                return;
                            }
                        }
                        reagir(origineMessage, zk, ms, cd.reaction);
                        cd.fonction(origineMessage, zk, commandeOptions);
                    } catch (e) {
                        console.log("Command error: " + e);
                        zk.sendMessage(origineMessage, { text: "❌ Error: " + e }, { quoted: ms });
                    }
                }
            }

            // ============= ANTI-LINK HANDLER (FULLY FIXED) =============
            try {
                const isAntiLinkEnabled = await verifierEtatJid(origineMessage);
                
                // Simple link detection
                let hasLink = false;
                if (texte) {
                    hasLink = texte.includes("http") || texte.includes("www.");
                }
                
                if (hasLink && verifGroupe && isAntiLinkEnabled) {
                    console.log("🔗 LINK DETECTED!");
                    
                    // Check if user is admin - CRITICAL: ADMIN PROTECTION
                    const userIsAdmin = verifGroupe ? admins.includes(auteurMessage) : false;
                    
                    // IMPORTANT: Skip if user is admin (don't delete admin links)
                    if (userIsAdmin) {
                        console.log("🛡️ SKIPPING: User is GROUP ADMIN - link not deleted");
                        return;
                    }
                    
                    // Skip if user is bot owner/superuser
                    if (superUser) {
                        console.log("👑 SKIPPING: User is BOT OWNER/SUPERUSER - link not deleted");
                        return;
                    }
                    
                    console.log("⚠️ User is NOT admin - applying anti-link action");
                    
                    // Message to delete
                    const messageToDelete = {
                        'remoteJid': origineMessage,
                        'fromMe': false,
                        'id': ms.key.id,
                        'participant': auteurMessage
                    };
                    
                    // Delete the message
                    try {
                        await zk.sendMessage(origineMessage, { 'delete': messageToDelete });
                        console.log("✅ Message deleted successfully!");
                    } catch(e) {
                        console.log("Delete failed:", e.message);
                    }
                    
                    // Get action from database
                    let action = await recupererActionJid(origineMessage);
                    if (!action) action = 'warn';
                    console.log("Action:", action);
                    
                    const maxWarns = conf.WARN_COUNT || 3;
                    
                    // ========== REMOVE MODE - Remove immediately ==========
                    if (action === 'remove') {
                        console.log("REMOVE MODE: Removing user immediately");
                        
                        // Send warning message first
                        const warnMsg = await zk.sendMessage(origineMessage, {
                            'text': `🚨 *LINK DETECTED!* 🚨\n\n@${auteurMessage.split('@')[0]} has been removed for sending links.\n\n🚫 Links are not allowed in this group!`,
                            'mentions': [auteurMessage]
                        }, { 'quoted': ms });
                        
                        // Wait a bit then remove user
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        try {
                            await zk.groupParticipantsUpdate(origineMessage, [auteurMessage], "remove");
                            console.log("✅ User removed from group");
                        } catch(e) { 
                            console.log("Remove failed:", e); 
                        }
                        return;
                    }
                    
                    // ========== WARN MODE - 3 strikes then remove ==========
                    if (action === 'warn') {
                        let warnCount = await getWarnCountByJID(auteurMessage) || 0;
                        console.log(`Current warns: ${warnCount}, Max: ${maxWarns}`);
                        
                        if (warnCount >= maxWarns - 1) {
                            // User has reached max warnings - REMOVE
                            console.log("WARN MODE: Max warnings reached, removing user");
                            
                            await zk.sendMessage(origineMessage, {
                                'text': `⚠️ *FINAL WARNING!* ⚠️\n\n@${auteurMessage.split('@')[0]} has been removed after ${maxWarns} warnings.\n\n🚫 Links are not allowed in this group!`,
                                'mentions': [auteurMessage]
                            }, { 'quoted': ms });
                            
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            
                            try {
                                await zk.groupParticipantsUpdate(origineMessage, [auteurMessage], "remove");
                                await resetWarnCountByJID(auteurMessage);
                                console.log("✅ User removed after max warnings");
                            } catch(e) { 
                                console.log("Remove failed:", e); 
                            }
                        } else {
                            // Add warning and send warning message
                            await ajouterUtilisateurAvecWarnCount(auteurMessage);
                            const newWarnCount = warnCount + 1;
                            const remaining = maxWarns - newWarnCount;
                            
                            let warningText = `⚠️ *WARNING!* ⚠️\n\n`;
                            warningText += `@${auteurMessage.split('@')[0]}, links are not allowed in this group!\n\n`;
                            warningText += `⚠️ *Warning ${newWarnCount}/${maxWarns}*\n`;
                            if (remaining > 0) {
                                warningText += `📌 You will be removed after ${remaining} more link(s).`;
                            }
                            
                            await zk.sendMessage(origineMessage, {
                                'text': warningText,
                                'mentions': [auteurMessage]
                            }, { 'quoted': ms });
                            
                            console.log(`⚠️ Warning ${newWarnCount}/${maxWarns} sent to user`);
                        }
                        return;
                    }
                    
                    // ========== DELETE MODE - Just delete with warning ==========
                    if (action === 'delete') {
                        console.log("DELETE MODE: Sending warning only");
                        
                        await zk.sendMessage(origineMessage, {
                            'text': `⚠️ *LINK DETECTED!* ⚠️\n\n@${auteurMessage.split('@')[0]}, your message has been deleted.\n\n🚫 Links are not allowed in this group!`,
                            'mentions': [auteurMessage]
                        }, { 'quoted': ms });
                        
                        console.log("✅ Warning message sent");
                        return;
                    }
                }
            } catch (error) {
                console.log("Anti-link error:", error);
            }
            // ============= END ANTI-LINK HANDLER =============

            // ============ ANTI-BOT ============
            if (!verifCom) {
                try {
                    const botMsg = ms.key?.id?.startsWith('BAES') && ms.key?.id?.length === 16;
                    const baileysMsg = ms.key?.id?.startsWith('BAE5') && ms.key?.id?.length === 16;
                    if (botMsg || baileysMsg) {
                        if (mtype === 'reactionMessage') return;
                        const antibotactiver = await atbverifierEtatJid(origineMessage);
                        if (!antibotactiver) return;
                        if (verifAdmin || auteurMessage === idBot) return;
                        
                        const key = {
                            remoteJid: origineMessage,
                            fromMe: false,
                            id: ms.key.id,
                            participant: auteurMessage
                        };
                        var action = await atbrecupererActionJid(origineMessage);
                        
                        if (action === 'remove') {
                            await zk.sendMessage(origineMessage, { delete: key });
                            await zk.groupParticipantsUpdate(origineMessage, [auteurMessage], "remove");
                        } else if (action === 'delete') {
                            await zk.sendMessage(origineMessage, { delete: key });
                        }
                    }
                } catch (er) {
                    console.log('Anti-bot error: ' + er);
                }
            }
        });

        const { recupevents } = require('./bdd/welcome');
        zk.ev.on('group-participants.update', async (group) => {
            try {
                const metadata = await zk.groupMetadata(group.id);
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
                        let msg = `*ÄŖŸÄŅ-ȚËĊȞ. 𝐖𝐄𝐋𝐂𝐎𝐌𝐄 𝐈𝐍 𝐓𝐇𝐄 𝐆𝐑𝐎𝐔𝐏 𝐌𝐄𝐒𝐒𝐀𝐆𝐄*\n\n]|I{•------»*𝐇𝐄𝐘* 🖐️ @${membre.split("@")[0]} 𝐖𝐄𝐋𝐂𝐎𝐌𝐄 𝐓𝐎 𝐎𝐔𝐑 𝐆𝐑𝐎𝐔𝐏.\n\n❒ *𝑅𝐸𝐴𝐷 𝑇𝐻𝐸 𝐺𝑅𝑂𝑈𝑃 𝐷𝐸𝑆𝐶𝑅𝐼𝑃𝑇𝐼𝑂𝑁 𝑇𝑂 𝐴𝑉𝑂𝐼𝐷 𝐺𝐸𝑇𝑇𝐼𝑁𝐺 𝑅𝐸𝑀𝑂𝑉𝐸𝐷 𝒚𝒐𝒖 🫩*`;
                        await zk.sendMessage(group.id, {
                            image: { url: ppuser },
                            caption: msg,
                            mentions: [membre]
                        });
                    } else if (group.action == 'remove' && (await recupevents(group.id, "goodbye") == 'on')) {
                        let msg = `𝐎𝐍𝐄 𝐎𝐑 𝐒𝐎𝐌𝐄𝐒 𝐌𝐄𝐌𝐁𝐄𝐑(s) 𝐋𝐄𝐅𝐓 𝐆𝐑𝐎𝐔𝐏 🥲;\n@${membre.split("@")[0]}`;
                        await zk.sendMessage(group.id, {
                            image: { url: ppuser },
                            caption: msg,
                            mentions: [membre]
                        });
                    }
                }
                if (group.action == 'promote' && (await recupevents(group.id, "antipromote") == 'on')) {
                    if (group.author == metadata.owner || group.author == conf.NUMERO_OWNER + '@s.whatsapp.net' || group.author == decodeJid(zk.user.id) || group.author == group.participants[0]) {
                        return;
                    };
                    await zk.groupParticipantsUpdate(group.id, [group.author, group.participants[0]], "demote");
                    zk.sendMessage(group.id, { text: `@${(group.author).split("@")[0]} violated anti-promotion rule.`, mentions: [group.author, group.participants[0]] });
                }
            } catch (e) {
                console.error("Error in group-participants.update:", e);
            }
        });

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
            return;
        }

        zk.ev.on("contacts.upsert", async (contacts) => {
            const insertContact = (newContact) => {
                for (const contact of newContact) {
                    if (store.contacts[contact.id]) {
                        Object.assign(store.contacts[contact.id], contact);
                    } else {
                        store.contacts[contact.id] = contact;
                    }
                }
                return;
            };
            insertContact(contacts);
        });

        zk.ev.on("connection.update", async (con) => {
            const { lastDisconnect, connection } = con;
            if (connection === "connecting") {
                console.log("ℹ️ aryan is connecting...");
            } else if (connection === 'open') {
                console.log("🔮 aryan Connected to your WhatsApp! 🫧");
                console.log("--");
                await (0, baileys_1.delay)(200);
                console.log("------");
                await (0, baileys_1.delay)(300);
                console.log("------------------/-----");
                console.log("👀 aryan is Online 🕸\n\n");
                console.log("🛒 Loading aryan Plugins...\n");
                fs.readdirSync(__dirname + "/commandes").forEach((fichier) => {
                    if (path.extname(fichier).toLowerCase() == (".js")) {
                        try {
                            require(__dirname + "/commandes/" + fichier);
                            console.log(fichier + "🛒🔑 aryan plugins Installed Successfully✔️");
                        } catch (e) {
                            console.log(`${fichier} could not be installed due to : ${e}`);
                        }
                        (0, baileys_1.delay)(300);
                    }
                });
                (0, baileys_1.delay)(700);
                var md;
                if ((conf.MODE).toLocaleLowerCase() === "yes") md = "public";
                else if ((conf.MODE).toLocaleLowerCase() === "no") md = "private";
                else md = "undefined";
                console.log("🏆🗡️ Aryan Plugins Installation Completed ✅");
                try {
                    const myChannelJid = "120363420172397674@newsletter";
                    await zk.newsletterFollow(myChannelJid);
                    console.log("✅ Bot imefuata channel yako!");
                } catch (e) {
                    console.log("Newsletter follow error: " + e);
                }
                await activateCrons();
                if ((conf.DP).toLowerCase() === 'yes') {
                    let cmsg = `ᴍᴀᴅᴇ ғʀᴏᴍ ᴛᴀɴᴢᴀɴɪᴀ 🇹🇿\n╭─────────────━┈⊷•\n│●│ *ᯤ ÄŖŸÄŅ-ȚËĊȞ: ᴄᴏɴɴᴇᴄᴛᴇᴅ*\n│¤│ᴘʀᴇғɪx: *[ ${prefixe} ]*\n│○│ᴍᴏᴅᴇ: *${(conf.MODE).toLowerCase() === "yes" ? "public" : "private"}*\n╰─────────────━┈⊷•⁠`;
                    await zk.sendMessage(zk.user.id, { text: cmsg });
                }
            } else if (connection == "close") {
                let raisonDeconnexion = new boom_1.Boom(lastDisconnect?.error)?.output.statusCode;
                if (raisonDeconnexion === baileys_1.DisconnectReason.badSession) console.log('Session id error, rescan again...');
                else if (raisonDeconnexion === baileys_1.DisconnectReason.connectionClosed) { console.log('Connection closed, reconnecting...'); setTimeout(main, 5000); }
                else if (raisonDeconnexion === baileys_1.DisconnectReason.connectionLost) { console.log('Connection lost, reconnecting...'); setTimeout(main, 5000); }
                else if (raisonDeconnexion === baileys_1.DisconnectReason.restartRequired) { console.log('Restart required...'); setTimeout(main, 5000); }
                else {
                    console.log('Restarting due to error:', raisonDeconnexion);
                    setTimeout(main, 5000);
                }
            }
        });

        zk.ev.on("creds.update", saveCreds);

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
            let trueFileName = './' + filename + '.' + type.ext;
            await fs.writeFile(trueFileName, buffer);
            return trueFileName;
        };

        return zk;
    }
    main();
}, 5000);
