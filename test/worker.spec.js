const utils = require('./utils');
const {waitEvent} = utils;

module.exports.addTests = function({testRunner, expect}) {
  const {describe, xdescribe, fdescribe, describe_fails_ffox} = testRunner;
  const {it, fit, xit} = testRunner;
  const {beforeAll, beforeEach, afterAll, afterEach} = testRunner;

  describe_fails_ffox('Workers', function() {
    it('Page.workers', async function({page, server}) {
      await Promise.all([
        new Promise(x => page.once('workercreated', x)),
        page.goto(server.PREFIX + '/worker/worker.html')]);
      const worker = page.workers()[0];
      expect(worker.url()).toContain('worker.js');

      expect(await worker.evaluate(() => self.workerFunction())).toBe('worker function result');

      await page.goto(server.EMPTY_PAGE);
      expect(page.workers().length).toBe(0);
    });
    it('should emit created and destroyed events', async function({page}) {
      const workerCreatedPromise = new Promise(x => page.once('workercreated', x));
      const workerObj = await page.evaluateHandle(() => new Worker('data:text/javascript,1'));
      const worker = await workerCreatedPromise;
      const workerThisObj = await worker.evaluateHandle(() => this);
      const workerDestroyedPromise = new Promise(x => page.once('workerdestroyed', x));
      await page.evaluate(workerObj => workerObj.terminate(), workerObj);
      expect(await workerDestroyedPromise).toBe(worker);
      const error = await workerThisObj.getProperty('self').catch(error => error);
      expect(error.message).toContain('Most likely the worker has been closed.');
    });
    it('should report console logs', async function({page}) {
      const [message] = await Promise.all([
        waitEvent(page, 'console'),
        page.evaluate(() => new Worker(`data:text/javascript,console.log(1)`)),
      ]);
      expect(message.text()).toBe('1');
      expect(message.location()).toEqual({
        url: 'data:text/javascript,console.log(1)',
        lineNumber: 0,
        columnNumber: 8,
      });
    });
    it('should have JSHandles for console logs', async function({page}) {
      const logPromise = new Promise(x => page.on('console', x));
      await page.evaluate(() => new Worker(`data:text/javascript,console.log(1,2,3,this)`));
      const log = await logPromise;
      expect(log.text()).toBe('1 2 3 JSHandle@object');
      expect(log.args().length).toBe(4);
      expect(await (await log.args()[3].getProperty('origin')).jsonValue()).toBe('null');
    });
    it('should have an execution context', async function({page}) {
      const workerCreatedPromise = new Promise(x => page.once('workercreated', x));
      await page.evaluate(() => new Worker(`data:text/javascript,console.log(1)`));
      const worker = await workerCreatedPromise;
      expect(await (await worker.executionContext()).evaluate('1+1')).toBe(2);
    });
    it('should report errors', async function({page}) {
      const errorPromise = new Promise(x => page.on('pageerror', x));
      await page.evaluate(() => new Worker(`data:text/javascript, throw new Error('this is my error');`));
      const errorLog = await errorPromise;
      expect(errorLog.message).toContain('this is my error');
    });
  });
  describe_fails_ffox('Nested Workers', function() {
    it('should report 2 workers', async function({page, server}) {
      await Promise.all([
        utils.waitEvent(page, 'workercreated', () => page.workers().length === 2),
        page.goto(server.PREFIX + '/worker/nested-workers.html'),
      ]);
      const workers = page.workers().sort((worker1, worker2) => worker1.url().localeCompare(worker2.url()));
      expect(workers[0].url()).toContain('/worker/main-worker.js');
      expect(workers[1].url()).toContain('/worker/nested-worker.js');
    });
    it('should have correct execution contexts for nested workers', async function({page, server}) {
      await Promise.all([
        utils.waitEvent(page, 'workercreated', () => page.workers().length === 2),
        page.goto(server.PREFIX + '/worker/nested-workers.html'),
      ]);
      const workers = page.workers().sort((worker1, worker2) => worker1.url().localeCompare(worker2.url()));
      expect(await workers[0].evaluate(() => self.whoami)).toBe('I am main worker');
      expect(await workers[1].evaluate(() => self.whoami)).toBe('I am nested worker');
    });
    it('should report errors from nested workers', async function({page, server}) {
      const [worker] = await Promise.all([
        utils.waitEvent(page, 'workercreated'),
        page.goto(server.PREFIX + '/worker/worker.html'),
      ]);
      const errorText = 'this is my error from nested worker';
      const [errorLog] = await Promise.all([
        utils.waitEvent(page, 'pageerror', event => event.message.includes(errorText)),
        worker.evaluate(errorText => new Worker(`data:text/javascript, throw new Error('${errorText}');`), errorText),
      ]);
      expect(errorLog.message).toContain(errorText);
    });
    it('should detach all workers when navigating away', async function({page, server}) {
      await Promise.all([
        utils.waitEvent(page, 'workercreated', () => page.workers().length === 2),
        page.goto(server.PREFIX + '/worker/nested-workers.html'),
      ]);
      await Promise.all([
        utils.waitEvent(page, 'workerdestroyed', () => page.workers().length === 0),
        page.goto(server.EMPTY_PAGE),
      ]);
    });
    it('should report console messages from nested workers', async function({page, server}) {
      const messages = [];
      page.on('console', msg => messages.push(msg.text()));
      await Promise.all([
        utils.waitEvent(page, 'console', () => messages.length === 2),
        page.goto(server.PREFIX + '/worker/nested-workers.html'),
      ]);
      messages.sort();
      expect(messages[0]).toBe('Main Worker');
      expect(messages[1]).toBe('Nested Worker');
    });
  });
};

