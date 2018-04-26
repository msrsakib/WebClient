import _ from 'lodash';

import { ENCRYPTED_STATUS, VERIFICATION_STATUS, MIME_TYPES } from '../../constants';
import { inlineCss } from '../../../helpers/domHelper';

const MAX_ENC_HEADER_LENGTH = 1024;
const PGPMIME_TYPES = [ENCRYPTED_STATUS.PGP_MIME, ENCRYPTED_STATUS.PGP_MIME_SIGNED];
const { PLAINTEXT } = MIME_TYPES;

/* @ngInject */
function messageModel(
    $q,
    $timeout,
    $rootScope,
    pmcw,
    gettextCatalog,
    authentication,
    AttachmentLoader,
    sanitize,
    attachmentConverter,
    publicKeyStore,
    attachedPublicKey,
    mailSettingsModel,
    addressesModel
) {
    const ENCRYPTED_HEADERS_FILENAME = gettextCatalog.getString(
        'Encrypted Headers',
        null,
        'Encrypted Headers filename'
    );
    const defaultMessage = {
        ID: '',
        Order: 0,
        Subject: '',
        PasswordHint: '',
        IsRead: 0,
        Type: 0,
        Sender: {},
        ToList: [],
        Time: 0,
        Size: 0,
        Attachments: [],
        NumAttachments: 0,
        IsEncrypted: 0,
        ExpirationTime: 0,
        IsReplied: 0,
        IsRepliedAll: 0,
        IsForwarded: 0,
        AddressID: '',
        CCList: [],
        BCCList: [],
        LabelIDs: [],
        ExternalID: null
    };
    const pmTypes = [
        gettextCatalog.getString('End-to-end encrypted', null, 'Message encryption status'),
        gettextCatalog.getString(
            'End-to-end encrypted from verified ProtonMail User',
            null,
            'Message encryption status'
        ),
        gettextCatalog.getString('Sender verification failed', null, 'Message encryption status')
    ];
    const pgpTypes = [
        gettextCatalog.getString('PGP-encrypted', null, 'Message encryption status'),
        gettextCatalog.getString('PGP-encrypted from verified sender', null, 'Message encryption status'),
        gettextCatalog.getString('Sender verification failed', null, 'Message encryption status')
    ];
    const clearTypes = [
        gettextCatalog.getString('Stored with zero access encryption', null, 'Message encryption status'),
        gettextCatalog.getString('PGP-signed from verified sender', null, 'Message encryption status'),
        gettextCatalog.getString('Sender verification failed', null, 'Message encryption status')
    ];
    const encryptionTypes = [
        // 0 - None
        [gettextCatalog.getString('Unencrypted', null, 'Message encryption status')],
        // 1 - Internal
        pmTypes,
        // 2 - External
        clearTypes,
        // 3 - Out enc
        [
            gettextCatalog.getString('Sent by you with end-to-end encryption', null, 'Message encryption status'),
            gettextCatalog.getString('Sent by you with end-to-end encryption', null, 'Message encryption status'),
            gettextCatalog.getString('Sender verification failed', null, 'Message encryption status')
        ],
        // 4 - Out plain
        [
            gettextCatalog.getString('Sent by you with zero access encryption', null, 'Message encryption status'),
            gettextCatalog.getString('Sent by you with zero access encryption', null, 'Message encryption status'),
            gettextCatalog.getString('Sender verification failed', null, 'Message encryption status')
        ],
        // 5 - Store enc
        [gettextCatalog.getString('Encrypted', null, 'Message encryption status')],
        // 6 - EO
        pmTypes,
        // 7 - PGP/Inline
        pgpTypes,
        // 8 - PGP/MIME
        pgpTypes,
        // 9 - Signed MIME
        clearTypes,
        // 10 - Auto response
        [gettextCatalog.getString('Sent by ProtonMail with zero access encryption', null, 'Message encryption status')]
    ];

    const emptyMessage = gettextCatalog.getString('Message empty', null, 'Message content if empty');
    const AUTOREPLY_HEADERS = ['X-Autoreply', 'X-Autorespond', 'X-Autoreply-From', 'X-Mail-Autoreply'];

    class Message {
        constructor(msg) {
            this.primaryKeyAttached = mailSettingsModel.get('AttachPublicKey');
            this.sign = mailSettingsModel.get('Sign');
            _.extend(this, angular.copy(msg));
            const { ParsedHeaders = {}, xOriginalTo } = msg;

            this.isAutoReply = AUTOREPLY_HEADERS.some((header) => header in ParsedHeaders);
            this.xOriginalTo = xOriginalTo || ParsedHeaders['X-Original-To'];

            return this;
        }
        isDraft() {
            return this.Type === 1;
        }

        getVerificationStatus() {
            return this.Verified;
        }

        generateReplyToken() {
            // Use a base64-encoded AES256 session key as the reply token
            return pmcw.generateSessionKey('aes256').then((key) => pmcw.encode_base64(pmcw.arrayToBinaryString(key)));
        }

        encryptionType() {
            const encType = encryptionTypes[this.IsEncrypted];
            return encType.length > this.Verified ? encType[this.Verified] : encType[0];
        }

        isPlainText() {
            return this.MIMEType === PLAINTEXT;
        }

        isSentByMe() {
            const { Address: senderAddress } = this.Sender;
            const addresses = addressesModel.get();
            return addresses.some(({ Email }) => Email === senderAddress);
        }

        plainText() {
            return this.getDecryptedBody();
        }

        disableOthers() {
            return (this.saving && !this.autosaving) || this.sending || this.encrypting || this.askEmbedding;
        }

        disableSend() {
            return this.uploading > 0 || this.disableOthers();
        }

        disableSave() {
            return this.disableSend();
        }
        disableDiscard() {
            return this.disableSend();
        }

        getAttachment(ID) {
            return _.find(this.Attachments || [], { ID });
        }

        getAttachments() {
            return this.Attachments || [];
        }

        attachmentsSize() {
            return (this.Attachments || []).reduce((acc, { Size = 0 } = {}) => acc + +Size, 0);
        }

        countEmbedded() {
            return this.Attachments.filter(({ Headers = {} }) => Headers['content-disposition'] === 'inline').length;
        }

        addAttachments(list = []) {
            this.Attachments = [].concat(this.Attachments, list);
            this.NumEmbedded = this.countEmbedded();
        }

        removeAttachment({ ID } = {}) {
            this.Attachments = (this.Attachments || []).filter((att) => att.ID !== ID);
            this.NumEmbedded = this.countEmbedded();
        }

        setDecryptedBody(input = '', purify = true) {
            this.DecryptedBody = !purify ? input : sanitize.message(inlineCss(input));
        }

        getDecryptedBody() {
            return this.DecryptedBody || '';
        }

        getListUnsubscribe() {
            const { ParsedHeaders = {} } = this;
            return ParsedHeaders['List-Unsubscribe'] || '';
        }

        close() {
            if (angular.isDefined(this.timeoutSaving)) {
                $timeout.cancel(this.timeoutSaving);
            }
        }

        isPGPInlineEncrypted() {
            return this.IsEncrypted === ENCRYPTED_STATUS.PGP_INLINE;
        }

        encryptBody(publicKeys) {
            const privateKeys = authentication.getPrivateKeys(this.From.ID)[0];
            return pmcw
                .encryptMessage({
                    data: this.getDecryptedBody(),
                    publicKeys: pmcw.getKeys(publicKeys),
                    privateKeys,
                    format: 'utf8',
                    compression: true
                })
                .then(({ data }) => ((this.Body = data), data))
                .catch((error) => {
                    error.message = gettextCatalog.getString('Error encrypting message');
                    throw error;
                });
        }

        async parse(content = '', verified = VERIFICATION_STATUS.NOT_VERIFIED) {
            const parseMail = (data) => {
                const deferred = $q.defer();
                const mailparser = new MailParser({ defaultCharset: 'UTF-8' });
                mailparser.on('end', deferred.resolve);
                mailparser.write(data);
                mailparser.end();
                return deferred.promise;
            };

            const data = await parseMail(content);
            // cf. https://github.com/autocrypt/memoryhole subject can be in the MIME headers
            const { attachments = [], text = '', html = '', subject: mimeSubject = false } = data;

            const result = await Promise.all(
                attachments.map(async (att) => {
                    const { headers } = await parseMail(att.content);
                    // cf. https://github.com/autocrypt/memoryhole
                    if (
                        _.has(att, 'fileName') ||
                        att.contentType !== 'text/rfc822-headers' ||
                        att.content.length > MAX_ENC_HEADER_LENGTH
                    ) {
                        return;
                    }
                    // probably some encrypted headers, not sure about the subjects yet. We don't want to attach them on reply
                    // the headers for this current message shouldn't be carried over to the next message.
                    att.generatedFileName = `${ENCRYPTED_HEADERS_FILENAME}.txt`;
                    att.contentDisposition = 'attachment';
                    // check for subject headers and from headers to match the current message with the right sender.
                    if (!_.has(headers, 'subject') || !_.has(headers, 'from')) {
                        return;
                    }
                    const sender = headers.from
                        .split('<')
                        .pop()
                        .replace('>', '')
                        .trim()
                        .toLowerCase();
                    if (sender !== this.Sender.Address.toLowerCase()) {
                        return;
                    }
                    // found the encrypted subject:
                    return headers.subject;
                })
            );

            const [encryptedSubject = mimeSubject] = _.filter(result);
            const convertedAttachments = attachmentConverter(this, attachments, verified);

            if (html) {
                return { message: html, attachments: convertedAttachments, verified, encryptedSubject };
            }
            this.MIMEType = PLAINTEXT;
            if (text) {
                return { message: text, attachments: convertedAttachments, verified, encryptedSubject };
            }
            if (convertedAttachments.length) {
                return { message: emptyMessage, attachments: convertedAttachments, verified, encryptedSubject };
            }
            this.MIMEParsingFailed = true;
            return { message: content, attachments: convertedAttachments, verified, encryptedSubject };
        }

        decryptBody() {
            const privateKeys = authentication.getPrivateKeys(this.AddressID);

            // decryptMessageLegacy expects message to be a string!
            const message = this.Body;
            this.decrypting = true;
            const { Address: sender } = this.Sender || {};

            const getPubKeys = (sender) => {
                // Sender can be empty
                // if so, do not look up public key
                if (!sender) {
                    return Promise.resolve(null);
                }

                return this.getPublicKeys([sender]).then((keys) => {
                    return [].concat(..._.values(keys));
                });
            };

            return getPubKeys(sender)
                .then((pubKeys) => {
                    return pmcw
                        .decryptMessageLegacy({
                            message,
                            privateKeys,
                            publicKeys: pubKeys,
                            date: new Date(this.Time * 1000)
                        })
                        .then(({ data, verified: pmcryptoVerified = VERIFICATION_STATUS.NOT_SIGNED }) => {
                            this.decrypting = false;
                            this.hasError = false;

                            const signedInvalid = VERIFICATION_STATUS.SIGNED_AND_INVALID;
                            const signedPubkey = VERIFICATION_STATUS.SIGNED_NO_PUB_KEY;
                            const verified =
                                !pubKeys.length && pmcryptoVerified === signedInvalid ? signedPubkey : pmcryptoVerified;

                            if (PGPMIME_TYPES.includes(this.IsEncrypted) || this.MIMEType === 'multipart/mixed') {
                                return this.parse(data, verified);
                            }

                            return { message: data, attachments: [], verified };
                        });
                })
                .catch((error) => {
                    this.networkError = error.status === -1;
                    this.hasError = true;
                    this.decrypting = false;
                    throw error;
                });
        }

        encryptAttachmentKeyPackets(publicKey = '', passwords = []) {
            const packets = {};

            return Promise.all(
                this.Attachments.filter(({ ID }) => ID.indexOf('PGPAttachment')).map((attachment) => {
                    return AttachmentLoader.getSessionKey(this, attachment).then(
                        ({ sessionKey = {}, AttachmentID, ID } = {}) => {
                            attachment.sessionKey = sessionKey; // Update the ref
                            return pmcw
                                .encryptSessionKey({
                                    data: sessionKey.data,
                                    algorithm: sessionKey.algorithm,
                                    publicKeys: publicKey.length ? pmcw.getKeys(publicKey) : [],
                                    passwords
                                })
                                .then(({ message }) => {
                                    packets[AttachmentID || ID] = pmcw.encode_base64(
                                        pmcw.arrayToBinaryString(message.packets.write())
                                    );
                                });
                        }
                    );
                })
            ).then(() => packets);
        }

        cleartextAttachmentKeyPackets() {
            const packets = {};

            return Promise.all(
                this.Attachments.map((attachment) => {
                    return AttachmentLoader.getSessionKey(this, attachment).then(
                        ({ sessionKey = {}, AttachmentID, ID } = {}) => {
                            attachment.sessionKey = sessionKey; // Update the ref
                            packets[AttachmentID || ID] = pmcw.encode_base64(pmcw.arrayToBinaryString(sessionKey.data));
                        }
                    );
                })
            ).then(() => packets);
        }

        cleartextBodyPackets() {
            const privateKeys = authentication.getPrivateKeys(this.AddressID);
            const { asymmetric, encrypted } = pmcw.splitMessage(this.Body);
            const message = pmcw.getMessage(asymmetric[0]);

            return pmcw
                .decryptSessionKey({ message, privateKeys })
                .then((sessionKey) => ({ sessionKey, dataPacket: encrypted }));
        }

        emailsToString() {
            return _.map(this.ToList.concat(this.CCList, this.BCCList), 'Address');
        }

        getPublicKeys(emails = []) {
            return publicKeyStore.get(emails);
        }

        getAttachedPublicKey() {
            return attachedPublicKey.extractFromEmail(this);
        }

        async clearTextBody(forceDecrypt = false) {
            if (!(this.isDraft() || this.IsEncrypted > 0)) {
                this.setDecryptedBody(this.Body, false);
                return this.getDecryptedBody();
            }

            if (this.getDecryptedBody() && !forceDecrypt) {
                return this.getDecryptedBody();
            }

            try {
                const result = await this.decryptBody();

                // handle attachments + optionally reverifying them
                // prevent adding pgp attachments twice: (calling clearTextBody twice, it happens)
                // result.attachments should first: this ensures the latest Verified value is used.
                this.Attachments = result.attachments.length ? result.attachments : this.Attachments;

                if (!(PGPMIME_TYPES.includes(this.IsEncrypted) || this.MIMEType === 'multipart/mixed')) {
                    await Promise.all(
                        this.Attachments.filter(AttachmentLoader.has).map((attachment) =>
                            AttachmentLoader.reverify(attachment, this)
                        )
                    );
                }

                this.setDecryptedBody(result.message, !this.isPlainText());
                this.Verified = result.verified;
                this.failedDecryption = false;

                if (result.encryptedSubject && this.Subject !== result.encryptedSubject) {
                    this.encryptedSubject = result.encryptedSubject;
                }
                this.NumAttachments = this.Attachments.length;
                this.NumEmbedded = this.countEmbedded();

                this.attachedPublicKey = await this.getAttachedPublicKey();

                this.hasError = false;

                $rootScope.$emit('message', { type: 'decrypted', data: { message: this } });

                return this.getDecryptedBody();
            } catch (err) {
                this.setDecryptedBody(this.Body, false);
                this.MIMEType = PLAINTEXT;
                this.failedDecryption = true;
                this.hasError = true;
                throw err;
            }
        }

        loadPGPAttachments() {
            return this.decryptBody()
                .then((result) => {
                    // prevent adding pgp attachments twice: (calling clearTextBody twice, it happened)
                    this.Attachments = _.uniq(this.Attachments.concat(result.attachments), false, ({ ID }) => ID);
                    this.NumAttachments = this.Attachments.length;
                    this.NumEmbedded = this.countEmbedded();
                })
                .then(() => this.getAttachedPublicKey())
                .then((publicKey) => (this.attachedPublicKey = publicKey));
        }
    }

    return (m = defaultMessage) => new Message(m);
}
export default messageModel;
