console.log('Main Worker');
self.whoami = 'I am main worker';
self.nestedWorker = new Worker('nested-worker.js');
