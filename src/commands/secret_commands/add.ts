import { readFile, statSync } from 'fs-extra';
import ora from 'ora';
import { basename } from 'path';

import { Builder, Handler } from './add.types';
import * as prompts from './add.prompts';
import * as outputs from './add.outputs';
import { baseOptions } from '../../shared';
import api from '../../services/api';
import { readUserConfig } from '../../services/config';
import crypto from '../../services/crypto';

export const command = 'add [name] [value]';
export const desc = 'Add end-to-end encrypted secret to vault';

export const builder: Builder = (yargs) =>
  yargs
    .options({
      ...baseOptions,
      file: { type: 'string', alias: 'f', conflicts: 'value' },
      vault: { type: 'string', alias: 'v' },
    })
    .positional('name', { type: 'string' })
    .positional('value', { type: 'string', conflicts: 'file' })
    .example([
      ['$0 add'],
      ['$0 add DB_PASSWORD 5Fqp2Mrs74Bp1RwSyV --profile project:phoenix'],
      ['$0 add --file .env.prod --vault devs'],
      ['$0 add -f alice.csv -v creds:aws -q --json | jq -r .SecretId | pbcopy'],
    ])
    .check((argv, _options) => {
      const { value, file } = argv;

      let contentLength: number;

      if (file) {
        contentLength = statSync(file).size;
      } else if (value) {
        contentLength = Buffer.from(value, 'utf8').length;
      } else {
        contentLength = 0;
      }

      if (contentLength > 10_000) {
        throw new Error('size of input binary cannot exceed 10kB');
      }

      return argv;
    });

export const handler: Handler = async (argv) => {
  const spinner = ora({
    isSilent: argv.quiet,
  });

  const { profile, value, file, vault: vaultName, json } = argv;

  const userConfig = await readUserConfig(profile);

  const { name: secretName = await getSecretName({ file }) } = argv;

  const { content, contentType } = await getBinaryValue({ file, value });

  let vaultId = userConfig.PersonalVault.Id;

  if (vaultName) {
    spinner.start('Fetching existing vault memberships');
    const vaultMemberships = await api.searchVaultMemberships(
      { VaultName: vaultName },
      { ApiKey: userConfig.Account.ApiKey },
    );
    spinner.succeed();

    vaultId = await prompts.confirmVaultId({ vaultMemberships });
  }

  // TODO: Can likely be moved to the if block above.
  spinner.start('Fetching vault keys');
  const vaultKeys = await api.retrieveVaultKeys(
    { VaultId: vaultId },
    { ApiKey: userConfig.Account.ApiKey },
  );
  spinner.succeed();

  const { accountPrivateKey } = await prompts.promptForExistingMasterPassword({
    accountPublicKey: userConfig.Account.PublicKey,
    accountEncryptedPrivateKey: userConfig.Account.EncryptedPrivateKey,
    accountEncryptionKeySalt: userConfig.Account.EncryptionKeySalt,
    useKeychain: userConfig.Device.UseKeychain,
    profile,
  });

  spinner.start('Encrypting contents');
  const vaultKeyPair = await crypto.decryptVaultEncryptedPrivateKey({
    accountPrivateKey,
    vaultPublicKey: vaultKeys.VaultPublicKey,
    vaultEncryptedPrivateKey: vaultKeys.VaultEncryptedPrivateKey,
  });

  const encryptedContent = await crypto.encryptBinaryWithVaultKeys({
    binary: content,
    vaultPublicKey: vaultKeyPair.publicKey,
    vaultPrivateKey: vaultKeyPair.privateKey,
  });
  spinner.succeed();

  spinner.start('Adding secret to vault');
  const { SecretId: secretId } = await api.addSecret(
    {
      SecretName: secretName,
      SecretEncryptedContent: encryptedContent,
      SecretContentType: contentType === 'file' ? 'File' : 'Text',
      VaultId: vaultId,
    },
    { ApiKey: userConfig.Account.ApiKey },
  );
  spinner.succeed();

  json
    ? outputs.secretAddedJson({ secretId, vaultId })
    : outputs.secretAdded({ secretName, vaultName });
};

const getSecretName = async ({
  file,
}: {
  file: string | undefined;
}): Promise<string> => {
  if (file) {
    return basename(file);
  } else {
    return prompts.confirmSecretName();
  }
};

const getBinaryValue = async ({
  file,
  value,
}: {
  file: string | undefined;
  value: string | undefined;
}): Promise<{ contentType: 'file' | 'text'; content: Buffer }> => {
  if (file) {
    return { contentType: 'file', content: await readFile(file) };
  } else if (value) {
    return { contentType: 'text', content: Buffer.from(value, 'utf8') };
  } else {
    return {
      contentType: 'text',
      content: Buffer.from(await prompts.confirmSecretValue(), 'utf8'),
    };
  }
};
