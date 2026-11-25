import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createMinigameHost } from '../scripts/lib/minigame-host.mjs';

function sdkFor(target, api = {}) {
  const native = { createCanvas: () => ({ width: 360, height: 800 }), ...api };
  return { native, sdk: createMinigameHost(native, target, { id: 'test-game' }, []).sdk };
}

for (const target of ['wechat', 'douyin', 'taptap']) {
  test(target + ' SDK uses the native API for login, session and launch options', async () => {
    let attempt;
    const { sdk, native } = sdkFor(target, {
      login(options) {
        assert.equal(this, native);
        attempt = options;
        options.success({ code: 'account-code', anonymousCode: 'guest-code' });
      },
      checkSession({ success }) { success(); },
      getLaunchOptionsSync() { return { scene: 1, query: { level: '2' } }; },
      openPlatformScreen() { return this; },
    });
    assert.equal(sdk.native.openPlatformScreen(), native);
    assert.equal(sdk.supports('login'), true);
    assert.equal(sdk.supports('rewardedVideo'), false);
    assert.deepEqual(await sdk.login(), { code: 'account-code' });
    assert.equal(attempt.force, target === 'douyin' ? true : undefined);
    assert.equal(await sdk.checkSession(), true);
    assert.deepEqual(sdk.getLaunchOptions().query, { level: '2' });
  });
}

test('SDK rejects unavailable APIs and does not report a guest code as an account login', async () => {
  const { sdk } = sdkFor('douyin', {
    login({ success }) { success({ anonymousCode: 'guest-only' }); },
    checkSession({ fail }) { fail({ errMsg: 'expired' }); },
  });
  await assert.rejects(sdk.login(), /code/i);
  assert.equal(await sdk.checkSession(), false);
  await assert.rejects(sdk.share({ title: 'Play' }), /unavailable/i);
  const { sdk: failed } = sdkFor('wechat', {
    login({ fail }) { fail({ errMsg: 'cancelled', errCode: 12 }); },
  });
  await assert.rejects(failed.login(), { message: 'cancelled', code: 12 });
});

test('SDK share distinguishes a request, a successful share, a cancellation, and an opened TapTap panel', async () => {
  const options = { title: 'Play', query: 'level=2', imageUrl: 'cover.png', templateId: 'tpl-1', sceneParam: 'level=2' };
  const { sdk: wechat } = sdkFor('wechat', {
    shareAppMessage(params) {
      assert.deepEqual(params, { title: 'Play', query: 'level=2', imageUrl: 'cover.png' });
    },
  });
  assert.deepEqual(await wechat.share(options), { status: 'requested' });
  const { sdk: douyin } = sdkFor('douyin', {
    shareAppMessage({ channel, templateId, imageUrl, success, fail }) {
      assert.equal(templateId, 'tpl-1');
      assert.equal(imageUrl, undefined);
      if (channel === 'cancel-test') fail({ errNo: 10502, errMsg: 'shareAppMessage:fail cancel' });
      else if (channel === 'error-test') fail({ errNo: 10301, errMsg: 'unavailable in host' });
      else success();
    },
  });
  assert.deepEqual(await douyin.share(options), { status: 'shared' });
  assert.deepEqual(await douyin.share({ ...options, channel: 'cancel-test' }), { status: 'cancelled' });
  await assert.rejects(douyin.share({ ...options, channel: 'error-test' }), { code: 10301 });
  const { sdk: tap } = sdkFor('taptap', {
    showShareboard({ templateId, sceneParam, success }) {
      assert.equal(templateId, 'tpl-1');
      assert.equal(sceneParam, 'level=2');
      success();
    },
  });
  assert.deepEqual(await tap.share(options), { status: 'opened' });
  await assert.rejects(tap.share({ title: 'Tap' }), /templateId/);
});

test('rewarded video settles on close, rejects overlap, and cleans up on close and on failure', async () => {
  let close;
  let onError;
  let showCount = 0;
  let failShow = false;
  const units = [];
  const ad = {
    async load() {},
    async show() {
      showCount++;
      if (failShow) throw new Error('no fill');
    },
    onClose(fn) { close = fn; },
    offClose(fn) { if (fn === close) close = null; },
    onError(fn) { onError = fn; },
    offError(fn) { if (fn === onError) onError = null; },
    destroy() {},
  };
  const { sdk } = sdkFor('taptap', {
    createRewardedVideoAd({ adUnitId }) { units.push(adUnitId); return ad; },
  });
  let settled = false;
  const first = sdk.showRewardedVideo('reward').then(result => { settled = true; return result; });
  await assert.rejects(sdk.showRewardedVideo('reward'), /progress/i);
  await setImmediate();
  assert.equal(showCount, 1);
  assert.equal(settled, false);
  close({ isEnded: false });
  assert.deepEqual(await first, { completed: false });
  assert.equal(close, null);
  assert.equal(onError, null);
  const second = sdk.showRewardedVideo('reward');
  await setImmediate();
  close({ isEnded: true });
  assert.deepEqual(await second, { completed: true });
  assert.deepEqual(units, ['reward']);
  const third = sdk.showRewardedVideo('second-unit');
  await setImmediate();
  close();
  assert.deepEqual(await third, { completed: false });
  assert.deepEqual(units, ['reward', 'second-unit']);
  failShow = true;
  await assert.rejects(sdk.showRewardedVideo('second-unit'), /no fill/);
  assert.equal(close, null);
  assert.equal(onError, null);
});

test('rewarded video loads before show on hosts that emit errors when called too early', async () => {
  let loaded = false;
  let onClose;
  let onError;
  const { sdk } = sdkFor('douyin', {
    createRewardedVideoAd: () => ({
      async load() { loaded = true; },
      async show() {
        if (!loaded) {
          onError({ errCode: 1004, errMsg: 'not loaded yet' });
          throw new Error('not loaded yet');
        }
        onClose({ isEnded: true });
      },
      onClose: callback => { onClose = callback; },
      offClose: () => { onClose = null; },
      onError: callback => { onError = callback; },
      offError: () => { onError = null; },
    }),
  });
  assert.deepEqual(await sdk.showRewardedVideo('reward'), { completed: true });
});
