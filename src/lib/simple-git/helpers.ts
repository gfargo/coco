interface ParsedFilePaths {
  filePath: string;
  oldFilePath?: string;
}

export const parseFileString = (file: string): ParsedFilePaths => {
  const separator = ' => ';
  
  if (file.includes(separator)) {
    const [oldFilePathWithRoot, filePath] = file.split(separator);

    const [rootPath, oldFilePath] = oldFilePathWithRoot.split("{")
    
    return {
      filePath: rootPath + filePath.trim().replace("{", "").replace("}", ""),
      oldFilePath: rootPath + oldFilePath.trim().replace("{", "").replace("}", "")
    };
  } else {
    // If the file string doesn't contain the separator, you can decide on a default behavior.
    // Here I'm assuming that the file string itself is the filePath, and oldFilePath is undefined.
    return {
      filePath: file.trim(),
      oldFilePath: undefined, // or you can return undefined if that's preferable
    };
  }
}
