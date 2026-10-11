/** 图片附件IO与任务执行命令分面；文件由Host持有，公开接口不返回凭据。 */
export interface TwoCodeImagesApi {
  importImage(input: {
    fileName: string;
    dataBase64: string;
  }): Promise<{ path: string; name: string; mime: string }>;
  readImage(path: string): Promise<{ dataBase64: string; mime: string }>;
}
