#!/usr/bin/env node
// game-reverse-scan.mjs — executable entry for the Game Reverse Scanner.
//
// Read-only first-pass scanning: inventories a game build, indexes ZIP-family
// containers, ranks engine candidates with evidence, and writes inventory.json,
// engine-profile.json, tool-recommendations.json and report.md.

import { main } from '../src/cli.mjs';

process.exitCode = await main(process.argv.slice(2));
