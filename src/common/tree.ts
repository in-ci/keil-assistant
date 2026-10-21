/**
 * 工程树节点的公共抽象。
 *
 * 侧边栏里的工程 / Target / 文件组 / 源文件都实现 IView，
 * ProjectExplorer 只依赖 IView，不关心节点的具体类型；
 * 新增节点类型时实现 IView 即可复用同一套树视图逻辑。
 */

export interface IView {
  label: string;
  prjID: string;
  icons?: { light: string; dark: string };
  tooltip?: string;
  contextVal?: string;
  getChildViews(): IView[] | undefined;
  /** 是否可能还有子节点；用于计算折叠状态，不必真的构造子节点 */
  hasChildViews(): boolean;
}

/** 复用的图标对象：同一图标的 { light, dark } 只创建一次 */
const iconPairCache = new Map<string, { light: string; dark: string }>();

/**
 * 取得图标对象。
 * 工程树里可能有上万个节点，每个节点都新建一个对象没有意义。
 */
export function getIconPair(name: string): { light: string; dark: string } {
  let pair = iconPairCache.get(name);
  if (pair === undefined) {
    pair = { light: name, dark: name };
    iconPairCache.set(name, pair);
  }
  return pair;
}
