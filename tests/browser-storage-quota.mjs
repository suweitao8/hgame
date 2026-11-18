import assert from 'node:assert/strict';

// Used only with the recipe harness's disposable browser context and origin.
export async function verifyStorageQuota(page) {
  await page.evaluate(async () => {
    const { createVersionedStore } = await import('./vendor/hgame/platform/storage.js');
    const saves = createVersionedStore({ gameId: 'recipe-quota', prefix: 'hgame.quota.test' });
    saves.save('progress', { score: 42 });
    saves.save('recover', { score: 1, padding: 'r'.repeat(4096) });
    saves.save('recover', { score: 2 });
    const damaged = saves.store.get('recover');
    damaged.data.score = 999;
    saves.store.set('recover', damaged);
    saves.store.set('legacy', { coins: 7 });
  });
  try {
    await page.reload();
    await page.waitForFunction(() => typeof window.__hgameState === 'function');
    const result = await page.evaluate(async () => {
      const { createVersionedStore } = await import('./vendor/hgame/platform/storage.js');
      // Fill storage in the same document that checks the failure and retry paths.
      let block = 'x'.repeat(64 * 1024);
      let exhausted = false;
      for (let attempt = 0; attempt < 256 && block.length; attempt++) {
        try { localStorage.setItem('hgame.quota.test.fill.' + attempt, block); }
        catch (error) {
          if (error.name !== 'QuotaExceededError') throw error;
          exhausted = true;
          block = block.slice(0, Math.floor(block.length / 2));
        }
      }
      if (!exhausted || block.length) throw new Error('Storage quota was not exhausted');
      const options = { gameId: 'recipe-quota', prefix: 'hgame.quota.test' };
      const saves = createVersionedStore(options);
      const migrated = createVersionedStore({ ...options, schemaVersion: 2,
        migrations: { 1: old => ({ gold: old.coins * 10, padding: 'm'.repeat(4096) }) } });
      const initial = saves.load('progress');
      let saveError;
      try { saves.save('progress', { score: 43, padding: 'w'.repeat(4096) }); }
      catch (error) { saveError = error.name; }
      const recovery = saves.load('recover');
      const migration = migrated.load('legacy');
      const full = {
        initial: initial.value, saveError,
        recovered: recovery.ok && recovery.recovered,
        recoveredScore: recovery.value?.score,
        recoveryWriteError: recovery.writebackError?.name,
        primaryStillCorrupt: !saves.verify('recover'),
        migrated: migration.ok && migration.migrated,
        gold: migration.value?.gold, migrationWriteError: migration.writebackError?.name,
        legacyStillOld: saves.store.get('legacy').coins === 7,
      };
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key?.startsWith('hgame.quota.test.fill.')) localStorage.removeItem(key);
      }
      const recoveryRetry = saves.load('recover');
      const migrationRetry = migrated.load('legacy');
      saves.save('progress', { score: 43 });
      return { full,
        recoveryRetried: recoveryRetry.ok && !Object.hasOwn(recoveryRetry, 'writebackError') && saves.verify('recover'),
        migrationRetried: migrationRetry.ok && !Object.hasOwn(migrationRetry, 'writebackError') && !migrated.load('legacy').migrated,
        savedAgain: saves.get('progress').score,
      };
    });
    assert.deepEqual(result.full, {
      initial: { score: 42 }, saveError: 'QuotaExceededError',
      recovered: true, recoveredScore: 1, recoveryWriteError: 'QuotaExceededError',
      primaryStillCorrupt: true, migrated: true, gold: 70,
      migrationWriteError: 'QuotaExceededError', legacyStillOld: true,
    });
    assert.equal(result.recoveryRetried, true);
    assert.equal(result.migrationRetried, true);
    assert.equal(result.savedAgain, 43);
    console.log(JSON.stringify({ storageQuota: result }));
  } finally {
    await page.evaluate(() => {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key?.startsWith('hgame.quota.test.')) localStorage.removeItem(key);
      }
    });
  }
}
