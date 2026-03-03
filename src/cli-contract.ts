export type CliSubcommandDoc = {
  command: string;
  usage: string;
  description: string;
  examples: string[];
};

export type CliCommandHandler = (args: string[]) => Promise<void>;
