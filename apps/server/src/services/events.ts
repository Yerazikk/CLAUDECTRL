import { EventEmitter } from 'events';
import type { ServerEvent } from '@claudectrl/shared';

class EventBroker extends EventEmitter {
  publish(event: ServerEvent): void {
    this.emit('event', event);
  }
}

export const broker = new EventBroker();
broker.setMaxListeners(200);
