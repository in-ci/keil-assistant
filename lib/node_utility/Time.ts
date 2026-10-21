let instance: Time;

/**
 * 时间分解信息接口。
 * 格式示例：2026/10/21|10:12:23|GMT+0800
 */
export interface TimeInfo {
  year: number;
  month: number;
  date: number;

  hour: number;
  minute: number;
  second: number;

  region: string;
}

/**
 * 时间日期格式化与解析工具类（单例模式）。
 */
export class Time {
  private date: Date;
  private Separater: string;

  private constructor() {
    this.date = new Date();
    this.Separater = "|";
  }

  /**
   * 获取 Time 单例对象。
   */
  static GetInstance(): Time {
    if (instance) {
      return instance;
    }
    instance = new Time();
    return instance;
  }

  /**
   * 获取当前时刻的时间戳字符串。
   * 格式: `YYYY/MM/DD|HH:MM:SS|GMT...`
   */
  GetTimeStamp(): string {
    this.date.setTime(Date.now());
    let dateStr = this.GetDateString();
    const tList = this.date.toTimeString().split(" ");
    dateStr += this.Separater + tList[0] + this.Separater + tList[1];
    return dateStr;
  }

  /**
   * 获取当前年月日字符串（如 2026/10/21）。
   */
  private GetDateString(): string {
    return (
      this.date.getFullYear().toString() +
      "/" +
      (this.date.getMonth() + 1).toString() +
      "/" +
      this.date.getDate().toString()
    );
  }

  /**
   * 获取当前时间结构化数据对象。
   */
  GetTimeInfo(): TimeInfo {
    this.date.setTime(Date.now());

    return {
      year: this.date.getFullYear(),
      month: this.date.getMonth(),
      date: this.date.getDate(),

      hour: this.date.getHours(),
      minute: this.date.getMinutes(),
      second: this.date.getSeconds(),

      region: this.date.toTimeString().split(" ")[1],
    };
  }

  /**
   * 解析形如 `YYYY/MM/DD|HH:MM:SS|Region` 的时间戳为结构体。
   */
  Parse(timeStamp: string): TimeInfo {
    const fieldList = timeStamp.split("|");
    const yearField = fieldList[0].split("/");
    const timeField = fieldList[1].split(":");

    return {
      year: Number.parseInt(yearField[0]),
      month: Number.parseInt(yearField[1]),
      date: Number.parseInt(yearField[2]),

      hour: Number.parseInt(timeField[0]),
      minute: Number.parseInt(timeField[1]),
      second: Number.parseInt(timeField[2]),

      region: fieldList[2],
    };
  }

  /**
   * 将结构体序列化为时间字符串。
   */
  Stringify(timeData: TimeInfo): string {
    return (
      timeData.year.toString() +
      "/" +
      timeData.month.toString() +
      "/" +
      timeData.date.toString() +
      "|" +
      timeData.hour.toString() +
      ":" +
      timeData.minute.toString() +
      ":" +
      timeData.second.toString() +
      "|" +
      timeData.region
    );
  }

  /**
   * 设置字段分隔符（默认为 "|"）。
   */
  SetTimeSeparater(sep: string) {
    this.Separater = sep;
  }

  /**
   * 获取当前使用的时间字段分隔符。
   */
  GetTimeSeparater(): string {
    return this.Separater;
  }
}
