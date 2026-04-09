import { createRepo, uploadFiles } from '@huggingface/hub';
import { config } from 'dotenv';
import fs from 'fs';
import path from 'path';
import { globSync } from 'glob';

// Load the .env file
config();

const HF_TOKEN = process.env.HF_TOKEN;
if (!HF_TOKEN) {
  console.error("❌ Erro: HF_TOKEN não encontrado no seu arquivo .env");
  process.exit(1);
}

const SPACE_NAME = "OpenCode-Elite";

async function deploy() {
  console.log(`\n🚀 Iniciando deploy automático para Hugging Face Spaces...\n`);

  try {
    // 1. Get user info to namespace the repo
    const userRes = await fetch("https://huggingface.co/api/whoami-v2", {
      headers: { Authorization: `Bearer ${HF_TOKEN}` }
    });
    
    if (!userRes.ok) {
        throw new Error("Token HF inválido ou sem permissão.");
    }
    const userData = await userRes.json();
    const username = userData.name;
    const repoId = `${username}/${SPACE_NAME}`;

    console.log(`◈ Verificando/Criando Space: ${repoId} ...`);

    // 2. Create the Repo (ignores error if already exists)
    try {
      await createRepo({
        repo: { type: 'space', name: repoId },
        credentials: { accessToken: HF_TOKEN },
        spaceSdk: 'docker',
      });
      console.log(`✅ Space criado com sucesso!`);
    } catch (e: any) {
      if (e.message && e.message.includes('already exists')) {
        console.log(`✅ Space já existe, vamos atualizar os arquivos!`);
      } else {
        throw e;
      }
    }

    // 3. Update the repo hardware to ensure it runs Docker properly
    console.log(`◈ Coletando arquivos para upload, preparando payload...`);

    // We need a README.md to define the Space config natively for HF
    const readmeContent = `---
title: OpenCode Elite
emoji: 👾
colorFrom: yellow
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---

# OpenCode — Elite AI Assistant
Powered by HuggingFace Inference API & NodeJS.
`;
    // Find all files that need to be uploaded
    // Exclude node_modules, .git, etc.
    const allFiles = globSync('**/*', { 
        ignore: ['node_modules/**', '.git/**', '.env', 'scripts/**', 'README.md', 'dist/**'],
        nodir: true
    });

    const filesToUpload = allFiles.map((filepath) => {
      const fullPath = path.resolve(process.cwd(), filepath);
      const buffer = fs.readFileSync(fullPath);
      // For Node 20+, a global Blob is available
      return {
        path: filepath.replace(/\\/g, '/'),
        content: new Blob([buffer])
      };
    });

    // Add our customized README.md for the Space
    filesToUpload.push({
      path: 'README.md',
      content: new Blob([readmeContent])
    });

    console.log(`◈ Fazendo upload de ${filesToUpload.length} arquivos... Isto pode levar alguns segundos.`);

    // 4. Upload files
    await uploadFiles({
      repo: { type: 'space', name: repoId },
      credentials: { accessToken: HF_TOKEN },
      files: filesToUpload,
      commitTitle: 'Deploy automático OpenCode via Antigravity 🚀'
    });

    console.log(`\n🎉 Deploy finalizado com sucesso!`);
    console.log(`\n🌐 Seu OpenCode está agora rodando 24h em:`);
    console.log(`\x1b[36mhttps://huggingface.co/spaces/${repoId}\x1b[0m\n`);
    
    console.log(`IMPORTANTE: Vá até as configurações do seu Space em:`);
    console.log(`https://huggingface.co/spaces/${repoId}/settings`);
    console.log(`E adicione a env var "HF_TOKEN" na seção "Variables and secrets" com o mesmo valor que você tem localmente! Isso gerantirá que os Agentes lá dentro usem sua chave.`);

  } catch (err: any) {
    console.error("\n❌ Falha no deploy:", err.message);
  }
}

deploy();
