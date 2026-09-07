import argparse
from getpass import getpass
from pathlib import Path

from dotenv import set_key
from pwdlib import PasswordHash


def main() -> None:
    parser = argparse.ArgumentParser(description="生成管理员密码哈希，或直接保存到项目 .env")
    parser.add_argument("--save", action="store_true", help="将新密码哈希保存到项目 .env")
    args = parser.parse_args()
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if args.save and not env_path.is_file():
        raise SystemExit("项目 .env 不存在，请先从 .env.example 创建配置。")
    password = getpass("新的管理员密码：")
    confirmation = getpass("再次输入密码：")
    if password != confirmation:
        raise SystemExit("两次输入的密码不一致")
    if len(password) < 12:
        raise SystemExit("密码至少需要 12 个字符")
    hashed = PasswordHash.recommended().hash(password)
    if args.save:
        set_key(str(env_path), "ADMIN_PASSWORD_HASH", hashed, quote_mode="always")
        print("管理员密码已保存到项目 .env。请停止并重新运行 pnpm dev，使新密码生效。")
    else:
        print(hashed)
        print("以上仅生成哈希，尚未修改管理员密码。可运行 pnpm admin:set 直接设置并保存。")


if __name__ == "__main__":
    main()
