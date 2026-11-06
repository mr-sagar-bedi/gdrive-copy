import { copy } from '../lib/main';
import GDriveService from '../lib/GDriveService';
import Timer from '../lib/Timer';
import TriggerService from '../lib/TriggerService';
import Util from '../lib/Util';
import Logging from '../lib/Logging';
import FeatureFlag from '../lib/FeatureFlag';
import MimeType from '../lib/MimeType';
const assert = require('assert');
const sinon = require('sinon');

function file(id, parent, mimeType = MimeType.DOC) {
  return { id, title: id, parents: [{ id: parent }], mimeType };
}

describe('copy() recovery and traversal', function() {
  beforeEach(function() {
    this.sandbox = sinon.createSandbox();
    this.clock = this.sandbox.useFakeTimers();
    this.globals = {};
    ['PropertiesService', 'Utilities', 'Logger'].forEach(name => {
      this.globals[name] = Object.getOwnPropertyDescriptor(global, name);
    });
    this.store = { triggerId: 'previous-trigger', trials: '0', stop: 'false' };
    this.userProperties = {
      getProperty: key => this.store[key],
      getProperties: () => this.store,
      setProperty: (key, value) => {
        this.store[key] = value;
      }
    };
    global.PropertiesService = {
      getUserProperties: () => this.userProperties
    };
    global.Utilities = {
      sleep: this.sandbox.stub(),
      formatDate: () => 'test-date'
    };
    global.Logger = { log: this.sandbox.stub() };
    this.skipDuplicates = FeatureFlag.SKIP_DUPLICATE_ID;
    FeatureFlag.SKIP_DUPLICATE_ID = true;
    this.state = {
      remaining: ['source'],
      map: { source: 'destination' },
      spreadsheetId: 'copy-log',
      retryQueue: [],
      completed: {}
    };
    this.download = this.sandbox
      .stub(GDriveService.prototype, 'downloadFile')
      .callsFake(() => JSON.stringify(this.state));
    this.sheet = {};
    this.openSpreadsheet = this.sandbox
      .stub(GDriveService.prototype, 'openSpreadsheet')
      .returns(this.sheet);
    this.getFiles = this.sandbox.stub(GDriveService.prototype, 'getFiles');
    this.copyFile = this.sandbox
      .stub(GDriveService.prototype, 'copyFile')
      .callsFake((body, id) => Object.assign({}, body, { id: 'copy-' + id }));
    this.insertFolder = this.sandbox
      .stub(GDriveService.prototype, 'insertFolder')
      .returns({ id: 'copied-folder' });
    this.deleteTrigger = this.sandbox.stub(TriggerService, 'deleteTrigger');
    this.createTrigger = this.sandbox.stub(TriggerService, 'createTrigger');
    this.log = this.sandbox.stub(Logging, 'log');
    this.cleanup = this.sandbox.stub(Util, 'cleanup');
  });

  afterEach(function() {
    this.sandbox.restore();
    FeatureFlag.SKIP_DUPLICATE_ID = this.skipDuplicates;
    Object.keys(this.globals).forEach(name => {
      if (this.globals[name]) {
        Object.defineProperty(global, name, this.globals[name]);
      } else {
        delete global[name];
      }
    });
  });

  it('finishes all pages, including an empty page, before traversing a queued subfolder', function() {
    this.getFiles.onCall(0).returns({
      items: [file('child', 'source', MimeType.FOLDER)],
      nextPageToken: 'page-2'
    });
    this.getFiles.onCall(1).returns({ items: [], nextPageToken: 'page-3' });
    this.getFiles.onCall(2).returns({ items: [file('root-file', 'source')] });
    this.getFiles.onCall(3).returns({ items: [file('nested-file', 'child')] });

    copy();

    assert.deepEqual(this.getFiles.args, [
      ['"source" in parents and trashed = false', undefined],
      ['"source" in parents and trashed = false', 'page-2'],
      ['"source" in parents and trashed = false', 'page-3'],
      ['"child" in parents and trashed = false', undefined]
    ]);
    assert.equal(this.insertFolder.callCount, 1);
    assert.equal(
      this.insertFolder.firstCall.args[0].parents[0].id,
      'destination'
    );
    assert.deepEqual(
      this.copyFile.args.map(args => [args[1], args[0].parents[0].id]),
      [['root-file', 'destination'], ['nested-file', 'copied-folder']]
    );
    const properties = this.cleanup.firstCall.args[0];
    assert.deepEqual(properties.remaining, []);
    assert.deepEqual(properties.retryQueue, []);
    assert.equal(properties.pageToken, undefined);
    assert(this.deleteTrigger.calledOnceWithExactly('previous-trigger'));
    assert(this.deleteTrigger.calledBefore(this.download));
    assert(this.createTrigger.calledOnceWithExactly(Timer.TRIGGER_TIME));
    assert(this.createTrigger.calledBefore(this.getFiles));
    assert(this.cleanup.calledOnce);
  });

  it('copies saved leftovers before resuming the saved page token without a remaining folder', function() {
    this.state.remaining = [];
    this.state.currFolderId = 'source';
    this.state.pageToken = 'saved-page';
    this.state.leftovers = {
      items: [file('leftover', 'source')],
      nextPageToken: 'saved-page'
    };
    this.getFiles.returns({ items: [file('next-file', 'source')] });

    copy();

    assert(
      this.getFiles.calledOnceWithExactly(
        '"source" in parents and trashed = false',
        'saved-page'
      )
    );
    assert(this.copyFile.firstCall.calledBefore(this.getFiles.firstCall));
    assert.deepEqual(this.copyFile.args.map(args => args[1]), [
      'leftover',
      'next-file'
    ]);
    const properties = this.cleanup.firstCall.args[0];
    assert.deepEqual(properties.leftovers.items, []);
    assert.equal(properties.currFolderId, 'source');
    assert.equal(properties.pageToken, undefined);
  });

  it('leaves unprocessed page items and the next token available for cleanup at the runtime limit', function() {
    const page = {
      items: [file('pending', 'source'), file('copied', 'source')],
      nextPageToken: 'next-page'
    };
    this.getFiles.returns(page);
    this.copyFile.callsFake((body, id) => {
      this.clock.tick(Timer.MAX_RUNTIME);
      return Object.assign({}, body, { id: 'copy-' + id });
    });

    copy();

    assert(this.getFiles.calledOnce);
    assert(this.copyFile.calledOnce);
    assert.equal(this.copyFile.firstCall.args[1], 'copied');
    assert.deepEqual(page.items.map(item => item.id), ['pending']);
    const [
      properties,
      fileList,
      userProperties,
      timer,
      sheet
    ] = this.cleanup.firstCall.args;
    assert.strictEqual(fileList, page);
    assert.equal(properties.pageToken, 'next-page');
    assert.strictEqual(userProperties, this.userProperties);
    assert.strictEqual(sheet, this.sheet);
    assert.equal(timer.canContinue(), false);
  });

  it('honors a persisted stop flag before copying leftovers or querying Drive', function() {
    this.store.stop = 'true';
    this.state.leftovers = { items: [file('leftover', 'source')] };
    this.state.retryQueue = [file('retry', 'source')];

    copy();

    assert(this.getFiles.notCalled);
    assert(this.copyFile.notCalled);
    const [properties, , , timer] = this.cleanup.firstCall.args;
    assert.equal(properties.leftovers.items.length, 1);
    assert.equal(properties.retryQueue.length, 1);
    assert.equal(timer.stop, true);
  });

  it('retries a failed copy before cleanup without marking the failed attempt as completed', function() {
    this.getFiles.returns({ items: [file('retry-file', 'source')] });
    this.copyFile.onFirstCall().throws(new Error('Temporary Drive failure'));

    copy();

    assert.equal(this.copyFile.callCount, 2);
    assert.deepEqual(
      this.copyFile.firstCall.args,
      this.copyFile.secondCall.args
    );
    const properties = this.cleanup.firstCall.args[0];
    assert.deepEqual(properties.retryQueue, []);
    assert.equal(properties.completed['retry-file'], true);
  });

  [
    { trials: '4', schedulesRetry: true },
    { trials: '5', schedulesRetry: false }
  ].forEach(({ trials, schedulesRetry }) => {
    it(`bounds restart attempts when loading state fails with trials=${trials}`, function() {
      this.store.trials = trials;
      this.download.throws(new Error('State document unavailable'));

      copy();

      assert.equal(this.download.callCount, 6);
      assert.equal(global.Utilities.sleep.callCount, 5);
      assert(this.deleteTrigger.calledOnceWithExactly('previous-trigger'));
      assert.equal(this.createTrigger.callCount, schedulesRetry ? 1 : 0);
      assert.equal(this.store.trials, schedulesRetry ? '5' : trials);
      assert(this.openSpreadsheet.notCalled);
      assert(this.getFiles.notCalled);
      assert(this.copyFile.notCalled);
      assert(this.cleanup.notCalled);
    });
  });
});
