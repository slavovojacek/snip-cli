import ora from 'ora';

import { Builder, Handler } from './list.types';
import * as outputs from './list.outputs';
import { baseOptions } from '../../shared';
import api from '../../services/api';
import { readUserConfig } from '../../services/config';

export const command = 'list';
export const aliases: Array<string> = ['ls'];
export const desc = 'List vaults you own or are a member of';

export const builder: Builder = (yargs) =>
  yargs
    .options({
      ...baseOptions,
    })
    .example([
      ['$0 vault list'],
      ['$0 vault ls'],
      ['$0 vault ls --profile project:phoenix -q --json | jq -r ".[].VaultId"'],
    ]);

export const handler: Handler = async (argv) => {
  const spinner = ora({
    isSilent: argv.quiet,
  });

  const { profile, json } = argv;

  const userConfig = await readUserConfig(profile);

  spinner.start('Fetching vault memberships');
  const vaultMemberships = await api.listVaultMemberships(
    {},
    { ApiKey: userConfig.Account.ApiKey },
  );
  spinner.succeed();

  outputs.listVaultMemberships({
    vaultMemberships,
    json,
  });
};
