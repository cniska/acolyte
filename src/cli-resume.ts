import type { chatModeWithOptions as chatModeWithOptionsType } from "./cli";

type ResumeModeDeps = {
  chatModeWithOptions: typeof chatModeWithOptionsType;
  hasHelpFlag: (args: string[]) => boolean;
  subcommandError: (name: string, message?: string) => void;
  subcommandHelp: (name: string) => void;
};

export async function resumeMode(args: string[], deps: ResumeModeDeps): Promise<void> {
  const { chatModeWithOptions, hasHelpFlag, subcommandError, subcommandHelp } = deps;
  if (hasHelpFlag(args)) {
    subcommandHelp("resume");
    return;
  }
  if (args.length > 1) {
    subcommandError("resume");
    return;
  }
  const resumePrefix = args[0]?.trim() || undefined;
  await chatModeWithOptions({ resumeLatest: true, resumePrefix });
}
