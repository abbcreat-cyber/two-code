import type { Event } from "@zcode/rpc";
/** 命名配置库与任务执行命令分面；配置形状由主契约传入，避免反向依赖。 */
export interface NamedCombination<Preferences> {
  id: string;
  name: string;
  preferences: Preferences;
}
export interface CombinationsView<Preferences> {
  revision: number;
  defaultId: string | null;
  items: NamedCombination<Preferences>[];
}
export interface CombinationsApi<Preferences> {
  combinations(): Promise<CombinationsView<Preferences>>;
  saveCombination(input: {
    revision: number;
    id?: string;
    name: string;
    preferences?: Preferences;
  }): Promise<CombinationsView<Preferences>>;
  defaultCombination(input: {
    revision: number;
    id: string;
  }): Promise<CombinationsView<Preferences>>;
  removeCombination(input: {
    revision: number;
    id: string;
  }): Promise<CombinationsView<Preferences>>;
  onDidCombinationsChange: Event<CombinationsView<Preferences>>;
}
