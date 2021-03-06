import { decryptMessage, getMessage } from 'pmcrypto';

import { MESSAGE_FLAGS, MIME_TYPES, MAILBOX_IDENTIFIERS, SIGNATURE_START } from '../app/constants';
import { normalizeEmail } from './string';
import { hasBit } from './bitHelper';

const {
    FLAG_RECEIVED,
    FLAG_SENT,
    FLAG_RECEIPT,
    FLAG_RECEIPT_REQUEST,
    FLAG_IMPORTED,
    FLAG_REPLIED,
    FLAG_REPLIEDALL,
    FLAG_FORWARDED,
    FLAG_INTERNAL,
    FLAG_AUTO,
    FLAG_E2E,
    FLAG_SIGN,
    FLAG_PUBLIC_KEY
} = MESSAGE_FLAGS;

const { MIME } = MIME_TYPES;

/**
 * Check if a message has a mime type
 * @return {function({MIMEType}): boolean}
 */
const hasMimeType = (type) => ({ MIMEType } = {}) => MIMEType === type;

/**
 * Check if a message has a flag in the flags bitmap
 * @param {Number} flag
 * @returns {Function}
 */
export const hasFlag = (flag) => ({ Flags = 0 } = {}) => hasBit(Flags, flag);

export const isReadReceipt = hasFlag(FLAG_RECEIPT);
export const isRequestReadReceipt = hasFlag(FLAG_RECEIPT_REQUEST);
export const isImported = hasFlag(FLAG_IMPORTED);
export const isInternal = hasFlag(FLAG_INTERNAL);
export const isExternal = (message) => !isInternal(message);
export const isAuto = hasFlag(FLAG_AUTO);
export const isReceived = hasFlag(FLAG_RECEIVED);
export const isSent = hasFlag(FLAG_SENT);
export const isReplied = hasFlag(FLAG_REPLIED);
export const isRepliedAll = hasFlag(FLAG_REPLIEDALL);
export const isForwarded = hasFlag(FLAG_FORWARDED);
export const isSentAndReceived = hasFlag(FLAG_SENT | FLAG_RECEIVED);
export const isDraft = (message) => !isSent(message) && !isReceived(message);
export const isE2E = hasFlag(FLAG_E2E);
export const isSentEncrypted = hasFlag(FLAG_E2E | FLAG_SENT);
export const isInternalEncrypted = hasFlag(FLAG_E2E | FLAG_INTERNAL);
export const isSign = hasFlag(FLAG_SIGN);
export const isAttachPublicKey = hasFlag(FLAG_PUBLIC_KEY);
export const isExternalEncrypted = (message) => isE2E(message) && !isInternal(message);
export const isPGPEncrypted = (message) => isExternal(message) && isReceived(message) && isE2E(message);
export const inSigningPeriod = ({ Time }) => Time >= SIGNATURE_START;

export const isMIME = hasMimeType(MIME);
export const isPGPInline = (message) => isPGPEncrypted(message) && !isMIME(message);

/**
 * Extract recipients addresses from a message
 * @param {Array} message.ToList
 * @param {Array} message.CCList
 * @param {Array} message.BCCList
 * @return {Array<Object>}
 */
export const getRecipients = ({ ToList = [], CCList = [], BCCList = [] } = {}) => {
    return ToList.concat(CCList, BCCList);
};

/**
 * Extract and normalize recipients
 * @param {Object} message
 * @return {Array<String>}
 */
export const normalizeRecipients = (message = {}) => {
    return getRecipients(message).map(({ Address }) => normalizeEmail(Address));
};

/**
 * Decrypt simple message body with password
 * @param {String} message.Body
 * @param {String} password
 * @return {String} body
 */
export async function decrypt({ Body = '' } = {}, password) {
    const message = await getMessage(Body);
    const { data: body } = await decryptMessage({
        message,
        passwords: [password]
    });
    return body;
}

/**
 * Get the label ids to add for a message that has moved.
 *
 * Types definition
 *   - 1: a draft
 * if you move it to trash and back to inbox, it will go to draft instead
 *   - 2: is sent
 *  if you move it to trash and back, it will go back to sent
 *   - 3: is inbox and sent (a message sent to yourself)
 * if you move it from trash to inbox, it will acquire both the inbox and sent labels ( 0 and 2 ).
 *
 * @param {Message} message
 * @param {String} labelID label id to which it is moved
 * @returns {Array}
 */
export const getLabelIDsMoved = (message, labelID) => {
    const toInbox = labelID === MAILBOX_IDENTIFIERS.inbox;

    if (toInbox) {
        // This message is a draft, if you move it to trash and back to inbox, it will go to draft instead
        if (message.isDraft()) {
            return [MAILBOX_IDENTIFIERS.allDrafts, MAILBOX_IDENTIFIERS.drafts];
        }

        // If you move it from trash to inbox, it will acquire both the inbox and sent labels ( 0 and 2 ).
        if (message.isSentAndReceived()) {
            return [MAILBOX_IDENTIFIERS.inbox, MAILBOX_IDENTIFIERS.allSent, MAILBOX_IDENTIFIERS.sent];
        }

        // This message is sent, if you move it to trash and back, it will go back to sent
        if (message.isSent()) {
            return [MAILBOX_IDENTIFIERS.allSent, MAILBOX_IDENTIFIERS.sent];
        }
    }

    return [labelID];
};

/**
 * Get date from message
 * @param {Integer} message.Time
 * @return {Date}
 */
export const getDate = ({ Time = 0 } = {}) => new Date(Time * 1000);

/**
 * Check if these all messages shared the same sender (by email address)
 * @param {Array<message>} messages
 * @return {Boolean}
 */
export const sameSender = (messages = []) => {
    if (!messages.length) {
        return false;
    }

    const [{ Sender: firstSender } = {}] = messages;
    const firstAddress = normalizeEmail(firstSender.Address);

    return (
        messages.length ===
        messages.filter(({ Sender = {} }) => {
            return normalizeEmail(Sender.Address) === firstAddress;
        }).length
    );
};

/**
 * List of tests we want to attach to a Message
 * Extend the prototype
 * @param  {Message.prototype} Message
 */
export const attachTests = (prototypeMessage = {}) => {
    [
        {
            name: 'isMIME',
            callback: isMIME
        },
        {
            name: 'isInternal',
            callback: isInternal
        },
        {
            name: 'isExternal',
            callback: isExternal
        },
        {
            name: 'isDraft',
            callback: isDraft
        },
        {
            name: 'isReplied',
            callback: isReplied
        },
        {
            name: 'isRepliedAll',
            callback: isRepliedAll
        },
        {
            name: 'isForwarded',
            callback: isForwarded
        },
        {
            name: 'isSent',
            callback: isSent
        },
        {
            name: 'isSentEncrypted',
            callback: isSentEncrypted
        },
        {
            name: 'isSentAndReceived',
            callback: isSentAndReceived
        },
        {
            name: 'isPGPInline',
            callback: isPGPInline
        },
        {
            name: 'isPGPEncrypted',
            callback: isPGPEncrypted
        },
        {
            name: 'isRequestReadReceipt',
            callback: isRequestReadReceipt
        },
        {
            name: 'isAttachPublicKey',
            callback: isAttachPublicKey
        },
        {
            name: 'isSign',
            callback: isSign
        },
        {
            name: 'inSigningPeriod',
            callback: inSigningPeriod
        },
        {
            name: 'isImported',
            callback: isImported
        },
        {
            name: 'getDate',
            callback: getDate
        }
    ].forEach(({ name, callback }) => {
        // We can't use fn.name as post minify the name will change.
        prototypeMessage[name] = function() {
            return callback(this);
        };
    });
};
