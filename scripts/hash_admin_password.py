from getpass import getpass

from pwdlib import PasswordHash


def main() -> None:
    password = getpass("新的管理员密码：")
    confirmation = getpass("再次输入密码：")
    if password != confirmation:
        raise SystemExit("两次输入的密码不一致")
    if len(password) < 12:
        raise SystemExit("密码至少需要 12 个字符")
    print(PasswordHash.recommended().hash(password))


if __name__ == "__main__":
    main()

