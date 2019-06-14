const {EventEmitter} = require('events');
const {helper, debugError, assert} = require('./helper');
const {Connection, CDPSession} = require('./Connection');
const Multimap = require('./Multimap');
const {Events} = require('./Events');

class SessionTree extends EventEmitter {
  constructor(root) {
    super();
    this._connection = Connection.fromSession(root);
    this._root = root;
    this._sessions = new Map();
    this._sessionChildren = new Multimap();
    this._listeners = new Multimap();
    this.on('removeListener', (eventName, listener) => {
      this._listeners.delete(eventName, listener);
      if (!this._listeners.has(eventName)) {
        for (const session of this._sessions.values())
          session.removeAllListeners(eventName);
      }
    });
    this.on('newListener', (eventName, listener) => {
      if (!this._listeners.has(eventName)) {
        for (const session of this._sessions.values())
          this._addSessionEventListener(session, eventName);
      }
      this._listeners.set(eventName, listener);
    });
  }

  _addSessionEventListener(session, eventName) {
    session.on(eventName, (...args) => this.emit(eventName, session, ...args));
  }

  async initialize() {
    await this._setupSession(CDPSession.sessionId(this._root), this._root);
  }

  async _setupSession(sessionId, session) {
    this._sessions.set(sessionId, session);
    for (const eventName of this._listeners.keys())
      this._addSessionEventListener(session, eventName);

    session.on('Target.attachedToTarget', async event => {
      if (event.targetInfo.type !== 'worker') {
        // If we don't detach from service workers, they will never die.
        session.send('Target.detachFromTarget', {
          sessionId: event.sessionId
        }).catch(debugError);
        return;
      }
      const newSession = this._connection.session(event.sessionId);
      this._sessionChildren.set(session, newSession);
      await this._setupSession(event.sessionId, newSession);
      this.emit(Events.SessionTree.SessionAttached, newSession, event.targetInfo);
    });
    session.on('Target.detachedFromTarget', event => {
      const session = this._sessions.get(event.sessionId);
      if (session)
        this._detachSession(session);
    });

    await session.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true
    }).catch(debugError);
  }

  _detachSession(session) {
    for (const child of this._sessionChildren.get(session))
      this._detachSession(child);
    this._sessionChildren.deleteAll(session);
    this.emit(Events.SessionTree.SessionDetached, session);
  }

  root() {
    return this._root;
  }

  async setProtocolState(method, params) {
  }
}

module.exports = {SessionTree};
