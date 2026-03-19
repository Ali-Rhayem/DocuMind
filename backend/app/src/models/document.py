from typing import Any

from pydantic import BaseModel


class Document(BaseModel):
	id: str
	source: str
	text: str
	metadata: dict[str, Any]
