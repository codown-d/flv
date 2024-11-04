import { IllegalStateException } from './exception'

let le = (() => {
  let buf = new ArrayBuffer(2);
  (new DataView(buf)).setInt16(0, 256, true)
  return (new Int16Array(buf))[0] === 256
})()

export type PraseValueDataType = undefined | number | Date | boolean | null | string | PraseValueDataType[] | {[k: string]: PraseValueDataType} | PraseValueReturnType

type PraseValueReturnType = {
  data: PraseValueDataType
  size: number
  objectEnd: boolean
}

class AMF {
  private static checkContinuation(uint8array: Uint8Array, start: number, checkLength: number): boolean {
    let array = uint8array
    if (start + checkLength < array.length) {
      while (checkLength--) {
        if ((array[++start] & 0xC0) !== 0x80) return false
      }
      return true
    } else {
      return false
    }
  }

  private static decodeUTF8(uint8array: Uint8Array): string {
    let out = []
    let input = uint8array
    let i = 0
    let length = uint8array.length

    while (i < length) {
      if (input[i] < 0x80) {
        out.push(String.fromCharCode(input[i]))
        ++i
        continue
      } else if (input[i] < 0xC0) {
        // fallthrough
      } else if (input[i] < 0xE0) {
        if (AMF.checkContinuation(input, i, 1)) {
          let ucs4 = (input[i] & 0x1F) << 6 | (input[i + 1] & 0x3F)
          if (ucs4 >= 0x80) {
            out.push(String.fromCharCode(ucs4 & 0xFFFF))
            i += 2
            continue
          }
        }
      } else if (input[i] < 0xF0) {
        if (AMF.checkContinuation(input, i, 2)) {
          let ucs4 = (input[i] & 0xF) << 12 | (input[i + 1] & 0x3F) << 6 | input[i + 2] & 0x3F
          if (ucs4 >= 0x800 && (ucs4 & 0xF800) !== 0xD800) {
            out.push(String.fromCharCode(ucs4 & 0xFFFF))
            i += 3
            continue
          }
        }
      } else if (input[i] < 0xF8) {
        if (AMF.checkContinuation(input, i, 3)) {
          let ucs4 = (input[i] & 0x7) << 18 | (input[i + 1] & 0x3F) << 12
            | (input[i + 2] & 0x3F) << 6 | (input[i + 3] & 0x3F)
          if (ucs4 > 0x10000 && ucs4 < 0x110000) {
            ucs4 -= 0x10000
            out.push(String.fromCharCode((ucs4 >>> 10) | 0xD800))
            out.push(String.fromCharCode((ucs4 & 0x3FF) | 0xDC00))
            i += 4
            continue
          }
        }
      }
      out.push(String.fromCharCode(0xFFFD))
      ++i
    }

    return out.join('')
  }

  public static parseScriptData(arrayBuffer: ArrayBuffer, dataOffset: number, dataSize: number) {
    let data: Record<string, PraseValueDataType> = {}

    try {
      let name = AMF.parseValue(arrayBuffer, dataOffset, dataSize)
      let value = AMF.parseValue(arrayBuffer, dataOffset + name.size, dataSize - name.size)
      if (typeof name.data === 'string') {
        data[name.data] = value.data
      }
    } catch (e: any) {
      console.log('AMF', e.toString())
    }

    return data
  }

  public static parseObject(arrayBuffer: ArrayBuffer, dataOffset: number, dataSize: number) {
    if (dataSize < 3) {
      throw new IllegalStateException('Data not enough when parse ScriptDataObject')
    }
    let name = AMF.parseString(arrayBuffer, dataOffset, dataSize)
    let value = AMF.parseValue(arrayBuffer, dataOffset + name.size, dataSize - name.size)
    let isObjectEnd = value.objectEnd

    return {
      data: {
        name: name.data,
        value: value.data,
      },
      size: name.size + value.size,
      objectEnd: isObjectEnd,
    }
  }

  public static parseVariable(arrayBuffer: ArrayBuffer, dataOffset: number, dataSize: number) {
    return AMF.parseObject(arrayBuffer, dataOffset, dataSize)
  }

  public static parseString(arrayBuffer: ArrayBuffer, dataOffset: number, dataSize: number) {
    if (dataSize < 2) {
      throw new IllegalStateException('Data not enough when parse String')
    }
    let v = new DataView(arrayBuffer, dataOffset, dataSize)
    let length = v.getUint16(0, !le)

    let str
    if (length > 0) {
      str = AMF.decodeUTF8(new Uint8Array(arrayBuffer, dataOffset + 2, length))
    } else {
      str = ''
    }

    return {
      data: str,
      size: 2 + length,
    }
  }

  public static parseLongString(arrayBuffer: ArrayBuffer, dataOffset: number, dataSize: number) {
    if (dataSize < 4) {
      throw new IllegalStateException('Data not enough when parse LongString')
    }
    let v = new DataView(arrayBuffer, dataOffset, dataSize)
    let length = v.getUint32(0, !le)

    let str
    if (length > 0) {
      str = AMF.decodeUTF8(new Uint8Array(arrayBuffer, dataOffset + 4, length))
    } else {
      str = ''
    }

    return {
      data: str,
      size: 4 + length,
    }
  }

  public static parseDate(arrayBuffer: ArrayBuffer, dataOffset: number, dataSize: number) {
    if (dataSize < 10) {
      throw new IllegalStateException('Data size invalid when parse Date')
    }
    let v = new DataView(arrayBuffer, dataOffset, dataSize)
    let timestamp = v.getFloat64(0, !le)
    let localTimeOffset = v.getInt16(8, !le)
    timestamp += localTimeOffset * 60 * 1000  // get UTC time

    return {
      data: new Date(timestamp),
      size: 8 + 2,
    }
  }

  public static parseValue(arrayBuffer: ArrayBuffer, dataOffset: number, dataSize: number): PraseValueReturnType {
    if (dataSize < 1) {
      throw new IllegalStateException('Data not enough when parse Value')
    }

    let v = new DataView(arrayBuffer, dataOffset, dataSize)

    let offset = 1
    let type = v.getUint8(0)
    let value: PraseValueReturnType['data']
    let objectEnd = false

    try {
      switch (type) {
        case 0:  // Number(Double) type
          value = v.getFloat64(1, !le)
          offset += 8
          break
        case 1: {  // Boolean type
          let b = v.getUint8(1)
          value = b ? true : false
          offset += 1
          break
        }
        case 2: {  // String type
          let amfstr = AMF.parseString(arrayBuffer, dataOffset + 1, dataSize - 1)
          value = amfstr.data
          offset += amfstr.size
          break
        }
        case 3: { // Object(s) type
          value = {}
          let terminal = 0  // workaround for malformed Objects which has missing ScriptDataObjectEnd
          if ((v.getUint32(dataSize - 4, !le) & 0x00FFFFFF) === 9) {
            terminal = 3
          }
          while (offset < dataSize - 4) {  // 4 === type(UI8) + ScriptDataObjectEnd(UI24)
            let amfobj = AMF.parseObject(arrayBuffer, dataOffset + offset, dataSize - offset - terminal)
            if (amfobj.objectEnd)
              break
            value[amfobj.data.name] = amfobj.data.value
            offset += amfobj.size
          }
          if (offset <= dataSize - 3) {
            let marker = v.getUint32(offset - 1, !le) & 0x00FFFFFF
            if (marker === 9) {
              offset += 3
            }
          }
          break
        }
        case 8: { // ECMA array type (Mixed array)
          value = {}
          offset += 4  // ECMAArrayLength(UI32)
          let terminal = 0  // workaround for malformed MixedArrays which has missing ScriptDataObjectEnd
          if ((v.getUint32(dataSize - 4, !le) & 0x00FFFFFF) === 9) {
            terminal = 3
          }
          while (offset < dataSize - 8) {  // 8 === type(UI8) + ECMAArrayLength(UI32) + ScriptDataVariableEnd(UI24)
            let amfvar = AMF.parseVariable(arrayBuffer, dataOffset + offset, dataSize - offset - terminal)
            if (amfvar.objectEnd)
              break
            value[amfvar.data.name] = amfvar.data.value
            offset += amfvar.size
          }
          if (offset <= dataSize - 3) {
            let marker = v.getUint32(offset - 1, !le) & 0x00FFFFFF
            if (marker === 9) {
              offset += 3
            }
          }
          break
        }
        case 9:  // ScriptDataObjectEnd
          value = undefined
          offset = 1
          objectEnd = true
          break
        case 10: {  // Strict array type
          // ScriptDataValue[n]. NOTE: according to video_file_format_spec_v10_1.pdf
          value = []
          let strictArrayLength = v.getUint32(1, !le)
          offset += 4
          for (let i = 0; i < strictArrayLength; i++) {
            let val = AMF.parseValue(arrayBuffer, dataOffset + offset, dataSize - offset)
            value.push(val.data)
            offset += val.size
          }
          break
        }
        case 11: {  // Date type
          let date = AMF.parseDate(arrayBuffer, dataOffset + 1, dataSize - 1)
          value = date.data
          offset += date.size
          break
        }
        case 12: {  // Long string type
          let amfLongStr = AMF.parseString(arrayBuffer, dataOffset + 1, dataSize - 1)
          value = amfLongStr.data
          offset += amfLongStr.size
          break
        }
        default:
          // ignore and skip
          offset = dataSize
          console.log('AMF', 'Unsupported AMF value type ' + type)
      }
    } catch (e: any) {
      console.log('AMF', e.toString())
    }

    return {
      data: value,
      size: offset,
      objectEnd: objectEnd,
    }
  }
}

export default AMF
