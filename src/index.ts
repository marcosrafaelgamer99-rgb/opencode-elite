/**
 * OpenCode — Entry Point
 * Starts the web server and serves the chatbot UI.
 * Run with: npm run dev
 */

import { startServer } from './api/server.js';
import chalk from 'chalk';

console.log(chalk.bold.cyanBright('\n  ◈ OpenCode — Elite AI Coding Assistant'));
console.log(chalk.dim('  Multi-agent pipeline · HuggingFace Inference API\n'));

startServer();
