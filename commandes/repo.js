"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { zokou } = require("../framework/zokou");
const axios = require("axios");
const s = require(__dirname + "/../set");

zokou({ nomCom: "repo", categorie: "General", reaction: "❄" }, async (dest, zk, commandeOptions) => {
  const { ms, repondre, auteurMessage } = commandeOptions;
  
  // GitHub API link
  const repoApi = "https://github.com/adev58285-star/ARYAN-TECH1";
  const img = 'https://files.catbox.moe/e51g2r.jpg';
  const channelJid = "120363420172397674@newsletter";

  try {
    const response = await axios.get(repoApi);
    const data = response.data;

    if (data) {
      const stars = data.stargazers_count;
      const forks = data.forks_count;
      const releaseDate = new Date(data.created_at).toLocaleDateString('en-GB');
      const lastUpdate = new Date(data.updated_at).toLocaleDateString('en-GB');

      // gitdata now starts with a mention
      const gitdata = `Hello @${auteurMessage.split('@')[0]}, *𝗜 𝗮𝗺* *ARYAN-TECH.*\n  
╭─────────────━┈⊷•
│🎲│ *𝗣𝗮𝗶𝗿 𝗰𝗼𝗱𝗲:* https://Aryan-happ-new-year-2026.onrender.com
│🪔│ *𝗥𝗲𝗽𝗼:* ${data.html_url}
│🌟│ *𝗦𝘁𝗮𝗿𝘀:* ${stars}
│🪡│ *𝗙𝗼𝗿𝗸𝘀:* ${forks}
│🎯│ *𝗥𝗲𝗹𝗲𝗮𝘀𝚎 𝗗𝗮𝘁𝗲:* ${releaseDate}
│✅│ *𝗨𝗽𝗱𝗮𝘁𝗲𝗱 𝗼𝗻:* ${lastUpdate}
│💫│ *𝗢𝘄𝗻𝗲𝗿:* ${s.OWNER_NAME}
╰─────────────━┈⊷•⁠⁠⁠⁠
                  
╭─────────────━┈⊷• 
│●│ *ᯤ Aryan-tech: ᴄᴏɴɴᴇᴄᴛᴇᴅ* │¤│ *NAME:* Aryan-tech
│○│ *MADE:* ғʀᴏᴍ ᴛᴀɴᴢᴀɴɪᴀ 🇹🇿 
╰─────────────━┈⊷•⁠⁠⁠⁠`;

      await zk.sendMessage(dest, { 
        image: { url: img }, 
        caption: gitdata,
        mentions: [auteurMessage], // This tags the person who typed the command
        contextInfo: {
          forwardingScore: 999,
          isForwarded: true,
          forwardedNewsletterMessageInfo: {
            newsletterJid: channelJid,
            newsletterName: "ARYAN-TECH 𝚄𝙿𝙳𝙰𝚃𝙴𝚂",
            serverMessageId: 1
          },
          externalAdReply: {
            title: "Aryan-tech 𝚂𝚈𝚂𝚃𝙴𝙼",
            body: "Bot Repository & Deployment",
            thumbnailUrl: img,
            sourceUrl: data.html_url,
            mediaType: 1,
            renderLargerThumbnail: false
          }
        }
      }, { quoted: ms });
    }
  } catch (error) {
    console.log("Error: " + error);
    repondre("🥵 Error fetching repository data.");
  }
});
