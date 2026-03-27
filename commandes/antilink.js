const { zokou } = require("../framework/zokou");
const { verifierEtatJid, recupererActionJid, mettreAJourActionJid, enregistrerJid, supprimerJid } = require("../bdd/antilien");
const { resetWarnCountByJID } = require("../bdd/warn");
const conf = require("../set");

zokou({
    nomCom: "antilink",
    categorie: "Group",
    reaction: "🔗"
}, async (dest, zk, commandeOptions) => {
    const { arg, repondre, verifGroupe, verifAdmin, superUser, ms, msgRepondu, auteurMsgRepondu, prefixe } = commandeOptions;

    if (!verifGroupe) {
        return repondre("❌ This command only works in groups.");
    }

    if (!verifAdmin && !superUser) {
        return repondre("🔒 Only group admins can use this command.");
    }

    try {
        const isActive = await verifierEtatJid(dest);
        
        if (!arg || !arg[0]) {
            const currentAction = await recupererActionJid(dest);
            let actionText = currentAction === 'warn' ? '⚠️ Warn (3 strikes then remove)' : 
                            currentAction === 'delete' ? '🗑️ Delete Only' : '🚫 Remove Immediately';
            const status = isActive ? '✅ ACTIVE' : '❌ INACTIVE';
            
            return repondre(`
╭━━━━━━━━━━━━━━━━━━╮
┃   🔗 ANTI-LINK    ┃
╰━━━━━━━━━━━━━━━━━━╯

📊 Status: ${status}
⚙️ Mode: ${actionText}

🛡️ *Group Admins are PROTECTED*
   Admin links will NOT be deleted!

📌 Commands:
• ${prefixe}antilink on - Activate
• ${prefixe}antilink off - Deactivate
• ${prefixe}antilink mode warn - 3 strikes (warn then remove)
• ${prefixe}antilink mode delete - Delete only with warning
• ${prefixe}antilink mode remove - Remove instantly
• ${prefixe}antilink clear @user - Reset warnings

⚡ ÄŖŸÄŅ-ȚËĊȞ MD`);
        }

        const cmd = arg[0].toLowerCase();

        if (cmd === "on" || cmd === "activate") {
            if (isActive) return repondre("⚠️ Anti-link is already active.");
            await enregistrerJid(dest);
            return repondre("✅ Anti-link activated!\n\n🛡️ Group admins are protected.\n⚙️ Default mode: Warn (3 strikes)");
        }

        if (cmd === "off" || cmd === "deactivate") {
            if (!isActive) return repondre("⚠️ Anti-link is not active.");
            await supprimerJid(dest);
            return repondre("❌ Anti-link deactivated.");
        }

        if (cmd === "mode") {
            const mode = arg[1]?.toLowerCase();
            if (!mode || !['warn', 'delete', 'remove'].includes(mode)) {
                return repondre(`⚠️ Available modes:\n• warn - 3 strikes then remove\n• delete - Delete only with warning\n• remove - Remove instantly\n\nExample: ${prefixe}antilink mode warn`);
            }
            await mettreAJourActionJid(dest, mode);
            let modeMsg = mode === 'warn' ? '3 strikes (warn then remove)' : 
                         mode === 'delete' ? 'Delete only with warning' : 'Remove instantly';
            return repondre(`✅ Anti-link mode updated to: ${modeMsg}\n\n🛡️ Group admins are still protected!`);
        }

        if (cmd === "clear" || cmd === "reset") {
            let targetJid = null;
            if (msgRepondu && auteurMsgRepondu) targetJid = auteurMsgRepondu;
            else if (arg[1] && arg[1].includes('@')) targetJid = arg[1].replace('@', '') + '@s.whatsapp.net';
            else if (arg[1] && /^\d+$/.test(arg[1])) targetJid = arg[1] + '@s.whatsapp.net';
            
            if (!targetJid) return repondre(`⚠️ Reply to user's message or mention them.\nExample: ${prefixe}antilink clear @user`);
            
            await resetWarnCountByJID(targetJid);
            return zk.sendMessage(dest, { text: `✅ Warnings reset for @${targetJid.split('@')[0]}`, mentions: [targetJid] }, { quoted: ms });
        }

        return repondre(`❌ Unknown command. Use ${prefixe}antilink for help.`);
    } catch (error) {
        console.error("Anti-link error:", error);
        return repondre(`❌ Error: ${error.message}`);
    }
});
