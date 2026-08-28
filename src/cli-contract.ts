export type CliCommandHelp = {
  command: string;
  usage: string;
  description: string;
  examples: string[];
};

export type CliCommandHandler = (args: string[]) => Promise<void>;

export type CliCommand = {
  help: () => CliCommandHelp;
  handler: CliCommandHandler;
  /** Kept out of the command table: the daemon spawns it, users reach the server through `start`. */
  hidden?: boolean;
};
