/**
 * 获取最长递增子序列，注意，返回的是索引数组
 * @param arr
 * @returns
 */
export function getSequence(arr: number[]): number[] {
  const result: number[] = [0];
  const p: number[] = arr.slice();

  for (let i = 1; i < arr.length; i++) {
    const lastIndex = result[result.length - 1];
    if (arr[i] > arr[lastIndex]) {
      result.push(i);
      p[i] = lastIndex;
      continue;
    }

    // 二分查找
    let l = 0;
    let r = result.length - 1;
    let c;
    while (l < r) {
      c = Math.floor((l + r) / 2);
      if (arr[result[c]] > arr[i]) {
        r = c;
      } else {
        l = c + 1;
      }
    }
    const firstGreaterThanIndex = r;
    result[firstGreaterThanIndex] = i;
    p[i] = result[firstGreaterThanIndex - 1];
  }

  // 回溯修正
  for (let i = result.length - 1; i >= 0; i--) {
    if (i >= 1) {
      if (result[i - 1] !== p[result[i]]) {
        result[i - 1] = p[result[i]];
      }
    }
  }

  return result;
}
