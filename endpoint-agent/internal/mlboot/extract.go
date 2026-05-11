package mlboot

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"os"
	"strings"
)

func extractLibFromTgz(tgzPath, libName, destPath string) error {
	f, err := os.Open(tgzPath)
	if err != nil {
		return err
	}
	defer f.Close()

	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()

	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if strings.HasSuffix(hdr.Name, libName) {
			out, err := os.Create(destPath + ".tmp")
			if err != nil {
				return err
			}
			if _, err := io.Copy(out, tr); err != nil {
				out.Close()
				os.Remove(destPath + ".tmp")
				return err
			}
			out.Close()
			return os.Rename(destPath+".tmp", destPath)
		}
	}
	return fmt.Errorf("%s not found in archive", libName)
}
