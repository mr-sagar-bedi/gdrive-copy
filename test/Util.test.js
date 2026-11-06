global.Utilities = require('./mocks/Utilities');
import Util from '../lib/Util';
import Timer from '../lib/Timer';
import TriggerService from '../lib/TriggerService';
import Properties from '../lib/Properties';
import Constants from '../lib/Constants';
import Logging from '../lib/Logging';
import ErrorMessages from '../lib/ErrorMessages';
const userProperties = require('./mocks/PropertiesService').getUserProperties();
const sinon = require('sinon');
const assert = require('assert');

describe('Util', function() {
  describe('exponentialBackoff()', function() {
    it('should retry 6 times on failure', function() {
      // set up mocks
      const errMsg = 'i failed';
      const failingFunc = sinon.stub().throws(errMsg);
      const stubLog = sinon.stub(Logging, 'log');

      const failingFunc2 = () => {
        throw new Error(errMsg);
      };

      // set up actual
      try {
        Util.exponentialBackoff(failingFunc, 'failure message');
      } catch (e) {}

      // assertions
      assert.equal(failingFunc.callCount, 6, 'failing func not called 6 times');
      assert.equal(stubLog.callCount, 7, 'Logging.log not called 7 times');

      // reset mocks
      stubLog.restore();
    });
    it('should rethrow error after 6 tries', function() {
      // set up mocks
      const errMsg = 'i failed';
      const stubLog = sinon.stub(Logging, 'log');
      const failingFunc2 = () => {
        throw new Error(errMsg);
      };

      // set up actual and assert
      assert.throws(
        () => {
          Util.exponentialBackoff(failingFunc, 'failure message');
        },
        Error,
        'threw wrong error after 6 attempts'
      );

      // reset mocks
      stubLog.restore();
    });
  });
  describe('cleanup()', function() {
    beforeEach(function() {
      this.clock = sinon.useFakeTimers();
    });
    afterEach(function() {
      this.clock.restore();
    });
    it('should set the "stop message" based on passed arguments', function() {
      // set up mocks
      const stubSaveState = sinon.stub(Util, 'saveState');
      const stubDeleteTrigger = sinon.stub(TriggerService, 'deleteTrigger');
      const timer = new Timer();
      this.clock.tick(Timer.TRIGGER_TIME);
      timer.update(userProperties);
      const fileList = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const properties = new Properties();

      // scenarios

      // normal pause
      let stopMsg = Constants.SingleRunExceeded;
      Util.cleanup(properties, fileList, userProperties, timer, {});
      assert(stubSaveState.calledOnce, 'saveState not called');
      assert.equal(
        stubSaveState.getCall(0).args[2],
        stopMsg,
        'saveState called with wrong stopMsg'
      );

      // user set stop flag
      userProperties.setProperty('stop', 'true');
      timer.update(userProperties);
      stopMsg = Constants.UserStoppedScript;
      Util.cleanup(properties, fileList, userProperties, timer, {});
      assert.equal(stubSaveState.callCount, 2, 'saveState not called twice');
      assert.equal(
        stubSaveState.getCall(1).args[2],
        stopMsg,
        'saveState called with wrong stopMsg'
      );
      userProperties.setProperty('stop', false);
      timer.update(userProperties);

      // max runtime exceeded
      properties.incrementTotalRuntime(Timer.MAX_RUNTIME_PER_DAY);
      properties.checkMaxRuntime();
      stopMsg = Constants.MaxRuntimeExceeded;
      Util.cleanup(properties, fileList, userProperties, timer, {});
      assert.equal(stubSaveState.callCount, 3, 'saveState not called thrice');
      assert.equal(
        stubSaveState.getCall(2).args[2],
        stopMsg,
        'saveState called with wrong stopMsg'
      );

      // restore mocks
      stubSaveState.restore();
      stubDeleteTrigger.restore();
      userProperties.setProperty('stop', false);
      timer.update(userProperties);
    });

    it('should save state if retryQueue is not empty', function() {
      // set up mocks
      const stubSaveState = sinon.stub(Util, 'saveState');
      const stubDeleteTrigger = sinon.stub(TriggerService, 'deleteTrigger');
      const timer = new Timer();
      const fileList = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const properties = new Properties();
      properties.retryQueue.push(...fileList);

      // normal pause
      Util.cleanup(properties, fileList, userProperties, timer, {});
      assert.equal(stubSaveState.callCount, 1, 'saveState not called once');

      // restore mocks
      stubSaveState.restore();
      stubDeleteTrigger.restore();
      userProperties.setProperty('stop', false);
      timer.update(userProperties);
    });
  });
  describe('composeErrorMsg()', function() {
    it('should return a string', function() {
      const actual = Util.composeErrorMsg({});
      assert(typeof actual === 'string', 'did not return string');
    });
    it('should prepend message with customMsg parap', function() {
      const customMsg = 'my custom message';
      const actual = Util.composeErrorMsg({}, customMsg);
      assert.notEqual(
        actual.indexOf(customMsg),
        -1,
        'did not find custom message in result'
      );
    });
    it('should include line and file identifiers in the error message', function() {
      const actual = Util.composeErrorMsg({});
      assert.notEqual(
        actual.indexOf('Line:'),
        -1,
        "did not find 'Line:' message in result"
      );
      assert.notEqual(
        actual.indexOf('File:'),
        -1,
        "did not find 'File:' message in result"
      );
    });
  });
  describe('log()', function() {
    xit('should log to spreadsheet', function() {});
    xit('should get spreadsheet if not passed as arg', function() {});
  });
  describe('saveState()', function() {
    let sandbox;
    const gDriveService = {};
    const sheet = {};

    beforeEach(function() {
      sandbox = sinon.createSandbox();
    });

    afterEach(function() {
      sandbox.restore();
    });

    it('should preserve processed items and the next page token', function() {
      const properties = new Properties();
      const fileList = {
        items: [{ id: 'processed-1' }, { id: 'processed-2' }],
        nextPageToken: 'next-page'
      };
      const save = sandbox.stub(Properties, 'save');
      const log = sandbox.stub(Logging, 'log');

      Util.saveState(properties, fileList, 'Paused', sheet, gDriveService);

      assert.deepEqual(properties.leftovers, fileList);
      assert.equal(properties.pageToken, 'next-page');
      assert(save.calledOnceWithExactly(properties, gDriveService));
      assert.equal(log.lastCall.args[0].status, 'Paused');
    });

    it('should keep existing leftovers and page token when no fresh file list is provided', function() {
      const properties = new Properties();
      properties.leftovers = {
        items: [{ id: 'leftover' }],
        nextPageToken: 'saved-page'
      };
      properties.pageToken = 'stale-page';
      const save = sandbox.stub(Properties, 'save');
      sandbox.stub(Logging, 'log');

      Util.saveState(properties, undefined, 'Paused', sheet, gDriveService);

      assert.deepEqual(properties.leftovers, {
        items: [{ id: 'leftover' }],
        nextPageToken: 'saved-page'
      });
      assert.equal(properties.pageToken, 'saved-page');
      assert(save.calledOnce);
    });

    it('should delete the scheduled trigger and only log warnings on Drive quota failure', function() {
      const properties = new Properties();
      const quotaError = new Error('exceeded their Drive storage quota');
      const save = sandbox.stub(Properties, 'save').throws(quotaError);
      const deleteTrigger = sandbox.stub(TriggerService, 'deleteTrigger');
      const log = sandbox.stub(Logging, 'log');

      Util.saveState(properties, undefined, 'Paused', sheet, gDriveService);

      assert(save.calledOnce);
      assert(
        deleteTrigger.calledOnceWithExactly(
          userProperties.getProperty('triggerId')
        )
      );
      assert.deepEqual(log.getCalls().map(call => call.args[0].status), [
        ErrorMessages.OutOfSpace,
        ErrorMessages.WillDuplicateOnResume
      ]);
    });

    it('should keep logging quota warnings if deleting the scheduled trigger fails', function() {
      const properties = new Properties();
      const save = sandbox
        .stub(Properties, 'save')
        .throws(new Error('exceeded their Drive storage quota'));
      const deleteTrigger = sandbox
        .stub(TriggerService, 'deleteTrigger')
        .throws(new Error('trigger already unavailable'));
      const log = sandbox.stub(Logging, 'log');

      assert.doesNotThrow(() =>
        Util.saveState(properties, undefined, 'Paused', sheet, gDriveService)
      );

      assert(save.calledOnce);
      assert(deleteTrigger.calledOnce);
      assert.deepEqual(log.getCalls().map(call => call.args[0].status), [
        ErrorMessages.OutOfSpace,
        ErrorMessages.WillDuplicateOnResume
      ]);
    });

    it('should log a diagnostic and the requested message on other save failures', function() {
      const properties = new Properties();
      const saveError = new Error('temporary Drive API failure');
      sandbox.stub(Properties, 'save').throws(saveError);
      const log = sandbox.stub(Logging, 'log');

      Util.saveState(properties, undefined, 'Paused', sheet, gDriveService);

      assert(log.calledTwice);
      assert(
        log.firstCall.args[0].status.includes(
          ErrorMessages.FailedSaveProperties
        )
      );
      assert(log.firstCall.args[0].status.includes(saveError.message));
      assert.equal(log.secondCall.args[0].status, 'Paused');
    });
  });
});
