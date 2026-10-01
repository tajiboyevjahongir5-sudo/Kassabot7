import { EventEmitter } from 'events';

class DonationEventEmitter extends EventEmitter {}

export const donationEvents = new DonationEventEmitter();
