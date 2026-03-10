export type CliCommandHelp = {
  command: string;
  usage: string;
  description: string;
  examples: string[];
};

export type CliCommandHandler = (args: string[]) => Promise<void>;

export type CliCommand = {
  help: CliCommandHelp;
  handler: CliCommandHandler;
};
